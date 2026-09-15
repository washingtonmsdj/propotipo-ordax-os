//go:build windows && ordax_raw_backend

package windowsadapter

// PhysicalApplyResult is the intentionally small success receipt exposed only
// by the tagged physical-test build. The normal/public Creator never compiles
// this boundary.
type PhysicalApplyResult struct {
	DiskNumber   uint32 `json:"disk_number"`
	BytesWritten int64  `json:"bytes_written"`
	SHA256       string `json:"sha256"`
}

// ApplyPhysicalTest binds the already-tested fail-closed writer orchestration
// to the real Windows runtime. This symbol exists only when both Windows and
// the explicit ordax_raw_backend build tag are selected.
func ApplyPhysicalTest(request RawDiskApplyRequest) (PhysicalApplyResult, error) {
	result, err := applyRawDiskInternal(windowsRawDiskRuntimeUnbound{}, request)
	if err != nil {
		return PhysicalApplyResult{}, err
	}
	return PhysicalApplyResult{
		DiskNumber:   result.DiskNumber,
		BytesWritten: result.BytesWritten,
		SHA256:       result.SHA256,
	}, nil
}
