//go:build windows && ordax_raw_backend

package windowsadapter

// PhysicalApplyResult is the intentionally small success receipt exposed only
// by the tagged physical-test build. The normal/public Creator never compiles
// this boundary.
type PhysicalApplyResult struct {
	DiskNumber       uint32 `json:"disk_number"`
	BytesWritten     int64  `json:"bytes_written"`
	BytesVerified    int64  `json:"bytes_verified"`
	SHA256           string `json:"sha256"`
	VerificationMode string `json:"verification_mode"`
}

// PhysicalApplyProgress is UI-only telemetry from the elevated physical writer.
// It never participates in authorization or target selection.
type PhysicalApplyProgress struct {
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

// ApplyPhysicalTest binds the already-tested fail-closed writer orchestration
// to the real Windows runtime. This symbol exists only when both Windows and
// the explicit ordax_raw_backend build tag are selected.
func ApplyPhysicalTest(request RawDiskApplyRequest) (PhysicalApplyResult, error) {
	return ApplyPhysicalTestWithProgress(request, nil)
}

// ApplyPhysicalTestWithProgress keeps the destructive path identical to
// ApplyPhysicalTest while exposing non-authoritative progress telemetry for the
// desktop Creator. The callback cannot change writer policy or I/O decisions.
func ApplyPhysicalTestWithProgress(request RawDiskApplyRequest, report func(PhysicalApplyProgress)) (PhysicalApplyResult, error) {
	var internal rawApplyProgressReporter
	if report != nil {
		internal = func(progress rawDiskApplyProgress) {
			report(PhysicalApplyProgress{
				Phase:          progress.Phase,
				CompletedBytes: progress.CompletedBytes,
				TotalBytes:     progress.TotalBytes,
			})
		}
	}
	result, err := applyRawDiskInternalWithProgress(windowsRawDiskRuntimeUnbound{}, request, internal)
	if err != nil {
		return PhysicalApplyResult{}, err
	}
	return PhysicalApplyResult{
		DiskNumber:       result.DiskNumber,
		BytesWritten:     result.BytesWritten,
		BytesVerified:    result.BytesVerified,
		SHA256:           result.SHA256,
		VerificationMode: result.VerificationMode,
	}, nil
}
