package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
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
	DiskNumber       uint32
	BytesWritten     int64
	BytesVerified    int64
	SHA256           string
	VerificationMode string
}

type writtenRegionProof struct {
	region creatorcore.PhysicalWriteRegion
	sha256 string
}

func writePreparedRegions(source io.ReaderAt, device rawDiskDevice, plan creatorcore.PhysicalWritePlan) ([]writtenRegionProof, int64, error) {
	proofs := make([]writtenRegionProof, 0, len(plan.Regions))
	var total int64
	for _, region := range plan.Regions {
		if region.OffsetBytes < 0 || region.LengthBytes <= 0 || region.OffsetBytes > int64(plan.TargetBytes)-region.LengthBytes {
			return nil, total, fmt.Errorf("prepared write region %q is out of bounds", region.Role)
		}
		digest := sha256.New()
		reader := io.NewSectionReader(source, region.OffsetBytes, region.LengthBytes)
		destination := io.NewOffsetWriter(device, region.OffsetBytes)
		written, err := io.Copy(io.MultiWriter(destination, digest), reader)
		if err != nil {
			return nil, total + written, fmt.Errorf("write prepared region %q: %w", region.Role, err)
		}
		if written != region.LengthBytes {
			return nil, total + written, fmt.Errorf(
				"prepared region %q write length mismatch: expected=%d actual=%d",
				region.Role,
				region.LengthBytes,
				written,
			)
		}
		proofs = append(proofs, writtenRegionProof{
			region: region,
			sha256: hex.EncodeToString(digest.Sum(nil)),
		})
		total += written
	}
	if total != plan.BytesToWrite {
		return nil, total, fmt.Errorf("prepared write total mismatch: expected=%d actual=%d", plan.BytesToWrite, total)
	}
	return proofs, total, nil
}

func verifyPreparedRegions(device rawDiskDevice, proofs []writtenRegionProof, expectedBytes int64) (int64, error) {
	var total int64
	for _, proof := range proofs {
		digest := sha256.New()
		reader := io.NewSectionReader(device, proof.region.OffsetBytes, proof.region.LengthBytes)
		readBytes, err := io.Copy(digest, reader)
		if err != nil {
			return total + readBytes, fmt.Errorf("read back prepared region %q: %w", proof.region.Role, err)
		}
		if readBytes != proof.region.LengthBytes {
			return total + readBytes, fmt.Errorf(
				"prepared region %q read-back length mismatch: expected=%d actual=%d",
				proof.region.Role,
				proof.region.LengthBytes,
				readBytes,
			)
		}
		actual := hex.EncodeToString(digest.Sum(nil))
		if actual != proof.sha256 {
			return total + readBytes, fmt.Errorf(
				"prepared region %q read-back SHA-256 mismatch: expected=%s actual=%s",
				proof.region.Role,
				proof.sha256,
				actual,
			)
		}
		total += readBytes
	}
	if total != expectedBytes {
		return total, fmt.Errorf("prepared read-back total mismatch: expected=%d actual=%d", expectedBytes, total)
	}
	return total, nil
}

func writeAndVerifyWholeImage(source io.Reader, device rawDiskDevice, streamImage VerifiedRawImage, diskNumber uint32) (rawDiskApplyResult, error) {
	destination := io.NewOffsetWriter(device, 0)
	written, err := streamRawImageVerified(source, destination, streamImage.SHA256, streamImage.SizeBytes)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	if written != streamImage.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("raw write length mismatch: expected=%d actual=%d", streamImage.SizeBytes, written)
	}
	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", diskNumber, err)
	}

	digest := sha256.New()
	reader := io.NewSectionReader(device, 0, streamImage.SizeBytes)
	readBytes, err := io.Copy(digest, reader)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("read back PhysicalDrive%d: %w", diskNumber, err)
	}
	if readBytes != streamImage.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back length mismatch: expected=%d actual=%d", streamImage.SizeBytes, readBytes)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != streamImage.SHA256 {
		return rawDiskApplyResult{}, fmt.Errorf("physical read-back SHA-256 mismatch: expected=%s actual=%s", streamImage.SHA256, actual)
	}
	return rawDiskApplyResult{
		DiskNumber:       diskNumber,
		BytesWritten:     written,
		BytesVerified:    readBytes,
		SHA256:           actual,
		VerificationMode: "full-image-sha256",
	}, nil
}

// applyRawDiskInternal is the fail-closed orchestration primitive for the
// Windows physical writer. Supported real USB capacities require a validated
// storage-v2 GPT and use region-scoped raw I/O; intentionally tiny unit-test
// fixtures retain the legacy byte-complete path so generic writer invariants
// remain independently exercised.
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

	if _, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("validate requested target identity: %w", err)
	}

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

	var preparedPlan *creatorcore.PhysicalWritePlan
	if _, layoutErr := creatorcore.PlanPhysicalStorage(uint64(streamImage.SizeBytes)); layoutErr == nil {
		plan, planErr := creatorcore.PlanPreparedPhysicalWrite(source, uint64(streamImage.SizeBytes))
		if planErr != nil {
			return rawDiskApplyResult{}, fmt.Errorf("physical write blocked: prepared storage-v2 image validation failed: %w", planErr)
		}
		preparedPlan = &plan
	}

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

	device, err := runtime.OpenVerifiedPhysicalDrive(confirmed, lease)
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("open verified PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	defer func() {
		if err := device.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close PhysicalDrive%d: %w", confirmed.DiskNumber, err)
		}
	}()

	if preparedPlan == nil {
		return writeAndVerifyWholeImage(source, device, streamImage, confirmed.DiskNumber)
	}

	proofs, written, err := writePreparedRegions(source, device, *preparedPlan)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	verified, err := verifyPreparedRegions(device, proofs, preparedPlan.BytesToWrite)
	if err != nil {
		return rawDiskApplyResult{}, err
	}

	return rawDiskApplyResult{
		DiskNumber:       confirmed.DiskNumber,
		BytesWritten:     written,
		BytesVerified:    verified,
		SHA256:           streamImage.SHA256,
		VerificationMode: "prepared-regions-sha256",
	}, nil
}
