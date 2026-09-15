package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// rawDiskDevice is the narrow I/O surface required by the internal writer.
// A Windows native adapter must bind the returned handle to the exact Target
// supplied to OpenVerifiedPhysicalDrive before returning it.
type rawDiskDevice interface {
	io.WriterAt
	io.ReaderAt
	Sync() error
	Close() error
}

// rawVolumeLease represents exclusive ownership of every Windows volume that
// belongs to the confirmed target disk. The production Windows implementation
// is intentionally not connected yet; fake runtimes use this boundary to prove
// ordering and lifetime before any native lock/dismount primitive is wired.
type rawVolumeLease interface {
	Close() error
}

// rawDiskRuntime deliberately separates destructive host I/O from policy.
// OpenVerifiedPhysicalDrive receives the exact lease acquired immediately
// before it; this makes it impossible for a future native runtime to satisfy
// the interface while silently opening a writable disk outside the lease
// boundary. Production Windows bindings are not connected to a public command.
type rawDiskRuntime interface {
	IsElevated() (bool, error)
	EnumerateTargets() ([]Target, error)
	AcquireTargetVolumeLease(expected Target) (rawVolumeLease, error)
	OpenVerifiedPhysicalDrive(expected Target, lease rawVolumeLease) (rawDiskDevice, error)
}

type rawDiskApplyResult struct {
	DiskNumber   uint32
	BytesWritten int64
	SHA256       string
}

// applyRawDiskInternal is the fail-closed orchestration primitive for a future
// Windows physical writer. It is intentionally unexported and has no CLI path.
// Tests exercise it only through fake in-memory runtimes.
func applyRawDiskInternal(runtime rawDiskRuntime, request RawDiskApplyRequest) (result rawDiskApplyResult, retErr error) {
	if runtime == nil {
		return rawDiskApplyResult{}, errors.New("raw-disk runtime is required")
	}

	elevated, err := runtime.IsElevated()
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("check Windows elevation: %w", err)
	}
	if !elevated {
		return rawDiskApplyResult{}, errors.New("physical write blocked: elevated Windows process is required")
	}

	// Validate the request-carried target before consulting the host. This
	// rejects a Target whose identity fields were modified while retaining an
	// old token.
	if _, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("validate requested target identity: %w", err)
	}

	// Re-enumeration happens at the destructive boundary, immediately before
	// any physical handle can be opened. A swapped or remapped USB therefore
	// invalidates the confirmation token.
	liveTargets, err := runtime.EnumerateTargets()
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("re-enumerate Windows USB targets: %w", err)
	}
	confirmed, err := MatchConfirmedTarget(liveTargets, request.ConfirmationToken)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("confirm live Windows USB target: %w", err)
	}

	validated := request
	validated.Target = confirmed
	if err := ValidateRawDiskApplyRequest(validated); err != nil {
		return rawDiskApplyResult{}, err
	}

	// Re-open and revalidate the exact source handle before any future
	// disruptive volume operation is allowed. On Windows this source handle
	// denies write sharing for its lifetime, so a path replacement or concurrent
	// writer cannot mutate the authorized image while the target is leased.
	source, streamImage, err := openVerifiedRawImageForApply(
		validated.Image.Path,
		validated.Image.SHA256,
		validated.Image.SizeBytes,
	)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("open stable verified raw image for streaming: %w", err)
	}
	defer func() {
		if err := source.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close raw image: %w", err)
		}
	}()

	// A future Windows runtime must lock/dismount the complete, isolated volume
	// inventory here and keep that lease until the exact physical device has
	// been closed after byte-complete read-back.
	lease, err := runtime.AcquireTargetVolumeLease(confirmed)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("acquire PhysicalDrive%d target-volume lease: %w", confirmed.DiskNumber, err)
	}
	if lease == nil {
		return rawDiskApplyResult{}, fmt.Errorf("acquire PhysicalDrive%d target-volume lease: runtime returned nil lease", confirmed.DiskNumber)
	}
	defer func() {
		if err := lease.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("release PhysicalDrive%d target-volume lease: %w", confirmed.DiskNumber, err)
		}
	}()

	// The acquired lease is explicitly passed into the physical-device open.
	// This compile-time boundary prevents a native implementation from opening a
	// writable PhysicalDrive without acknowledging the exact lease held by the
	// orchestrator.
	device, err := runtime.OpenVerifiedPhysicalDrive(confirmed, lease)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("open verified PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	defer func() {
		if err := device.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close PhysicalDrive%d: %w", confirmed.DiskNumber, err)
		}
	}()

	// OffsetWriter makes the starting offset explicit rather than depending on
	// an inherited file cursor. streamRawImageVerified caps writes at the exact
	// authorized image size and refuses any changed source identity.
	destination := io.NewOffsetWriter(device, 0)
	written, err := streamRawImageVerified(source, destination, streamImage.SHA256, streamImage.SizeBytes)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	if written != streamImage.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("raw write length mismatch: expected=%d actual=%d", streamImage.SizeBytes, written)
	}

	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}

	// Success requires byte-complete read-back verification from the same open
	// physical device. The target-volume lease remains held through this proof
	// and through device close, so no remount can race the verified operation.
	digest := sha256.New()
	reader := io.NewSectionReader(device, 0, streamImage.SizeBytes)
	readBytes, err := io.Copy(digest, reader)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("read back PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	if readBytes != streamImage.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back length mismatch: expected=%d actual=%d", streamImage.SizeBytes, readBytes)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != streamImage.SHA256 {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back SHA-256 mismatch: expected=%s actual=%s", streamImage.SHA256, actual)
	}

	return rawDiskApplyResult{
		DiskNumber:   confirmed.DiskNumber,
		BytesWritten: written,
		SHA256:       actual,
	}, nil
}
