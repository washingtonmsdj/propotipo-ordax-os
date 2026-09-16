package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
)

type rawDiskDevice interface {
	io.WriterAt
	io.ReaderAt
	Sync() error
	Close() error
}

type rawVolumeLease interface {
	Close() error
}

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

type rawDiskApplyProgress struct {
	Phase          string
	CompletedBytes int64
	TotalBytes     int64
}

type rawApplyProgressReporter func(rawDiskApplyProgress)

func reportRawApplyProgress(report rawApplyProgressReporter, phase string, completedBytes, totalBytes int64) {
	if report == nil {
		return
	}
	report(rawDiskApplyProgress{Phase: phase, CompletedBytes: completedBytes, TotalBytes: totalBytes})
}

type progressCountWriter struct{ onWrite func(int64) }

func (writer progressCountWriter) Write(data []byte) (int, error) {
	if writer.onWrite != nil && len(data) > 0 {
		writer.onWrite(int64(len(data)))
	}
	return len(data), nil
}

type writtenRegionProof struct {
	region creatorcore.PhysicalWriteRegion
	sha256 string
}

func writePreparedRegions(source io.ReaderAt, device rawDiskDevice, plan creatorcore.PhysicalWritePlan, report rawApplyProgressReporter) ([]writtenRegionProof, int64, error) {
	proofs := make([]writtenRegionProof, 0, len(plan.Regions))
	var total int64
	reportRawApplyProgress(report, "writing", 0, plan.BytesToWrite)
	for _, region := range plan.Regions {
		if region.OffsetBytes < 0 || region.LengthBytes <= 0 || region.OffsetBytes > int64(plan.TargetBytes)-region.LengthBytes {
			return nil, total, fmt.Errorf("prepared write region %q is out of bounds", region.Role)
		}
		digest := sha256.New()
		reader := io.NewSectionReader(source, region.OffsetBytes, region.LengthBytes)
		destination := io.NewOffsetWriter(device, region.OffsetBytes)
		regionBase := total
		var regionProgress int64
		counter := progressCountWriter{onWrite: func(delta int64) {
			regionProgress += delta
			reportRawApplyProgress(report, "writing", regionBase+regionProgress, plan.BytesToWrite)
		}}
		written, err := io.Copy(io.MultiWriter(destination, digest, counter), reader)
		if err != nil {
			return nil, total + written, fmt.Errorf("write prepared region %q: %w", region.Role, err)
		}
		if written != region.LengthBytes {
			return nil, total + written, fmt.Errorf("prepared region %q write length mismatch: expected=%d actual=%d", region.Role, region.LengthBytes, written)
		}
		proofs = append(proofs, writtenRegionProof{region: region, sha256: hex.EncodeToString(digest.Sum(nil))})
		total += written
	}
	if total != plan.BytesToWrite {
		return nil, total, fmt.Errorf("prepared write total mismatch: expected=%d actual=%d", plan.BytesToWrite, total)
	}
	reportRawApplyProgress(report, "writing", total, plan.BytesToWrite)
	return proofs, total, nil
}

func verifyPreparedRegions(device rawDiskDevice, proofs []writtenRegionProof, expectedBytes int64, report rawApplyProgressReporter) (int64, error) {
	var total int64
	reportRawApplyProgress(report, "verifying", 0, expectedBytes)
	for _, proof := range proofs {
		digest := sha256.New()
		reader := io.NewSectionReader(device, proof.region.OffsetBytes, proof.region.LengthBytes)
		regionBase := total
		var regionProgress int64
		counter := progressCountWriter{onWrite: func(delta int64) {
			regionProgress += delta
			reportRawApplyProgress(report, "verifying", regionBase+regionProgress, expectedBytes)
		}}
		readBytes, err := io.Copy(io.MultiWriter(digest, counter), reader)
		if err != nil {
			return total + readBytes, fmt.Errorf("read back prepared region %q: %w", proof.region.Role, err)
		}
		if readBytes != proof.region.LengthBytes {
			return total + readBytes, fmt.Errorf("prepared region %q read-back length mismatch: expected=%d actual=%d", proof.region.Role, proof.region.LengthBytes, readBytes)
		}
		actual := hex.EncodeToString(digest.Sum(nil))
		if actual != proof.sha256 {
			return total + readBytes, fmt.Errorf("prepared region %q read-back SHA-256 mismatch: expected=%s actual=%s", proof.region.Role, proof.sha256, actual)
		}
		total += readBytes
	}
	if total != expectedBytes {
		return total, fmt.Errorf("prepared read-back total mismatch: expected=%d actual=%d", expectedBytes, total)
	}
	reportRawApplyProgress(report, "verifying", total, expectedBytes)
	return total, nil
}

func writeAndVerifyWholeImage(source io.Reader, device rawDiskDevice, streamImage VerifiedRawImage, diskNumber uint32, report rawApplyProgressReporter) (rawDiskApplyResult, error) {
	reportRawApplyProgress(report, "writing", 0, streamImage.SizeBytes)
	destination := io.NewOffsetWriter(device, 0)
	written, err := streamRawImageVerified(source, destination, streamImage.SHA256, streamImage.SizeBytes)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	if written != streamImage.SizeBytes {
		return rawDiskApplyResult{}, fmt.Errorf("raw write length mismatch: expected=%d actual=%d", streamImage.SizeBytes, written)
	}
	reportRawApplyProgress(report, "writing", written, streamImage.SizeBytes)
	reportRawApplyProgress(report, "flushing", 0, 0)
	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", diskNumber, err)
	}
	reportRawApplyProgress(report, "verifying", 0, streamImage.SizeBytes)
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
	reportRawApplyProgress(report, "verifying", readBytes, streamImage.SizeBytes)
	reportRawApplyProgress(report, "verified", readBytes, streamImage.SizeBytes)
	return rawDiskApplyResult{DiskNumber: diskNumber, BytesWritten: written, BytesVerified: readBytes, SHA256: actual, VerificationMode: "full-image-sha256"}, nil
}

func applyRawDiskInternal(runtime rawDiskRuntime, request RawDiskApplyRequest) (result rawDiskApplyResult, retErr error) {
	return applyRawDiskInternalWithProgress(runtime, request, nil)
}

func applyRawDiskInternalWithProgress(runtime rawDiskRuntime, request RawDiskApplyRequest, report rawApplyProgressReporter) (result rawDiskApplyResult, retErr error) {
	if runtime == nil {
		return rawDiskApplyResult{}, errors.New("raw-disk runtime is required")
	}
	reportRawApplyProgress(report, "checking-elevation", 0, 0)
	elevated, err := runtime.IsElevated()
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("check Windows elevation: %w", err)
	}
	if !elevated {
		return rawDiskApplyResult{}, errors.New("physical write blocked: elevated Windows process is required")
	}
	reportRawApplyProgress(report, "revalidating-target", 0, 0)
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
	if _, err := validateRawDiskApplyRequestPolicy(validated); err != nil {
		return rawDiskApplyResult{}, err
	}
	reportRawApplyProgress(report, "validating-image", 0, 0)
	source, streamImage, err := openVerifiedRawImageForApplyWithProgress(validated.Image.Path, validated.Image.SHA256, validated.Image.SizeBytes, func(completedBytes, totalBytes int64) {
		reportRawApplyProgress(report, "validating-image", completedBytes, totalBytes)
	})
	if err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("open stable verified raw image for streaming: %w", err)
	}
	defer func() {
		if err := source.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close raw image: %w", err)
		}
	}()
	reportRawApplyProgress(report, "planning-write", 0, 0)
	var preparedPlan *creatorcore.PhysicalWritePlan
	if _, layoutErr := creatorcore.PlanPhysicalStorage(uint64(streamImage.SizeBytes)); layoutErr == nil {
		var plan creatorcore.PhysicalWritePlan
		var planErr error
		if validated.BootstrapSeedBytes > 0 {
			plan, planErr = creatorcore.PlanPreparedPhysicalWrite(source, uint64(streamImage.SizeBytes), uint64(validated.BootstrapSeedBytes))
		} else {
			plan, planErr = creatorcore.PlanPreparedPhysicalWrite(source, uint64(streamImage.SizeBytes))
		}
		if planErr != nil {
			return rawDiskApplyResult{}, fmt.Errorf("physical write blocked: prepared storage-v2 image validation failed: %w", planErr)
		}
		preparedPlan = &plan
	}
	reportRawApplyProgress(report, "locking-target", 0, 0)
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
		return writeAndVerifyWholeImage(source, device, streamImage, confirmed.DiskNumber, report)
	}
	proofs, written, err := writePreparedRegions(source, device, *preparedPlan, report)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	reportRawApplyProgress(report, "flushing", written, preparedPlan.BytesToWrite)
	if err := device.Sync(); err != nil {
		return rawDiskApplyResult{}, fmt.Errorf("flush PhysicalDrive%d: %w", confirmed.DiskNumber, err)
	}
	verified, err := verifyPreparedRegions(device, proofs, preparedPlan.BytesToWrite, report)
	if err != nil {
		return rawDiskApplyResult{}, err
	}
	mode := "prepared-regions-sha256"
	if validated.BootstrapSeedBytes > 0 {
		mode = "seed-bounded-regions-sha256"
	}
	reportRawApplyProgress(report, "verified", verified, preparedPlan.BytesToWrite)
	return rawDiskApplyResult{DiskNumber: confirmed.DiskNumber, BytesWritten: written, BytesVerified: verified, SHA256: streamImage.SHA256, VerificationMode: mode}, nil
}
