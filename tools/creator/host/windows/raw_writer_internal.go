package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
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

// rawDiskRuntime deliberately separates destructive host I/O from policy.
// Production Windows bindings are not connected to a public command yet.
type rawDiskRuntime interface {
	IsElevated() (bool, error)
	EnumerateTargets() ([]Target, error)
	OpenVerifiedPhysicalDrive(expected Target) (rawDiskDevice, error)
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

	// ValidateRawDiskApplyRequest hashes the complete image before the device is
	// opened. Re-open only after that proof; streamRawImageVerified re-hashes the
	// bytes actually sent to the device and detects shrink/growth during I/O.
	source, err := os.Open(validated.Image.Path)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("open verified raw image for streaming: %w", err)
	}
	defer func() {
		if err := source.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close raw image: %w", err)
		}
	}()

	device, err := runtime.OpenVerifiedPhysicalDrive(confirmed)
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
	written, err := streamRawImageVerified(source, destination, validated.Image.SHA256, validated.Image.SizeBytes)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	if written != validated.Image.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("raw write length mismatch: expected=%d actual=%d", validated.Image.SizeBytes, written)
	}

	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}

	// Success requires byte-complete read-back verification from the same open
	// physical device. The full authorized extent is hashed and must match the
	// source digest before the operation can report success.
	digest := sha256.New()
	reader := io.NewSectionReader(device, 0, validated.Image.SizeBytes)
	readBytes, err := io.Copy(digest, reader)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("read back PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	if readBytes != validated.Image.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back length mismatch: expected=%d actual=%d", validated.Image.SizeBytes, readBytes)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != validated.Image.SHA256 {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back SHA-256 mismatch: expected=%s actual=%s", validated.Image.SHA256, actual)
	}

	return rawDiskApplyResult{
		DiskNumber:   confirmed.DiskNumber,
		BytesWritten: written,
		SHA256:       actual,
	}, nil
}
