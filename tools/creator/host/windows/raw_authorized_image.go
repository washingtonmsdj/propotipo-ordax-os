package windowsadapter

import (
	"fmt"
	"os"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
)

// openAuthorizedRawImageForApply preserves the legacy whole-image verifier for
// generic fixtures, while production storage-v2 requests use the exact
// seed-bounded write plan. The latter keeps TOCTOU protection by hashing the
// same locked file handle later used for raw I/O.
func openAuthorizedRawImageForApply(request RawDiskApplyRequest, report rawApplyProgressReporter) (*os.File, VerifiedRawImage, *creatorcore.PhysicalWritePlan, error) {
	if request.BootstrapSeedBytes <= 0 {
		source, image, err := openVerifiedRawImageForApplyWithProgress(request.Image.Path, request.Image.SHA256, request.Image.SizeBytes, func(completedBytes, totalBytes int64) {
			reportRawApplyProgress(report, "validating-image", completedBytes, totalBytes)
		})
		if err != nil {
			return nil, VerifiedRawImage{}, nil, err
		}
		if _, layoutErr := creatorcore.PlanPhysicalStorage(uint64(image.SizeBytes)); layoutErr != nil {
			return source, image, nil, nil
		}
		plan, planErr := creatorcore.PlanPreparedPhysicalWrite(source, uint64(image.SizeBytes))
		if planErr != nil {
			_ = source.Close()
			return nil, VerifiedRawImage{}, nil, fmt.Errorf("prepared storage-v2 image validation failed: %w", planErr)
		}
		return source, image, &plan, nil
	}

	source, image, err := openStableRawImageForApply(request.Image.Path, request.Image.SizeBytes)
	if err != nil {
		return nil, VerifiedRawImage{}, nil, err
	}
	plan, err := creatorcore.PlanPreparedPhysicalWrite(source, uint64(image.SizeBytes), uint64(request.BootstrapSeedBytes))
	if err != nil {
		_ = source.Close()
		return nil, VerifiedRawImage{}, nil, fmt.Errorf("prepared storage-v2 image validation failed: %w", err)
	}
	digest, err := creatorcore.HashPhysicalWritePlan(source, plan, func(completedBytes, totalBytes int64) {
		reportRawApplyProgress(report, "validating-image", completedBytes, totalBytes)
	})
	if err != nil {
		_ = source.Close()
		return nil, VerifiedRawImage{}, nil, fmt.Errorf("hash prepared write plan: %w", err)
	}
	if digest != request.Image.SHA256 {
		_ = source.Close()
		return nil, VerifiedRawImage{}, nil, fmt.Errorf("prepared write-plan SHA-256 mismatch: expected=%s actual=%s", request.Image.SHA256, digest)
	}
	image.SHA256 = digest
	return source, image, &plan, nil
}
