//go:build windows

package windowsadapter

import (
	"fmt"
	"os"
	"unsafe"
)

const genericWritePhysicalDrive uintptr = 0x40000000

var _ rawDiskDevice = (*os.File)(nil)

// openVerifiedPhysicalDriveWritableUnbound is the final native handle primitive
// immediately before raw bytes could be written. It is intentionally unexported
// and deliberately not connected to any rawDiskRuntime or public command.
//
// The function refuses to call CreateFileW unless the Target remains current
// and the caller supplies the exact active managed target-volume lease for the
// same PhysicalDrive. The newly opened writable handle is then identity-proved
// using the same handle before it can be returned.
func openVerifiedPhysicalDriveWritableUnbound(expected Target, lease rawVolumeLease) (*os.File, error) {
	managed, err := validateManagedTargetVolumeLease(expected, lease)
	if err != nil {
		return nil, err
	}

	path := fmt.Sprintf(`\\.\PhysicalDrive%d`, expected.DiskNumber)
	ptr, err := utf16Ptr(path)
	if err != nil {
		return nil, err
	}
	handle, _, callErr := procCreateFileW.Call(
		uintptr(unsafe.Pointer(ptr)),
		genericReadPhysicalDrive|genericWritePhysicalDrive,
		fileShareRead|fileShareWrite,
		0,
		openExisting,
		0,
		0,
	)
	if handle == ^uintptr(0) {
		return nil, fmt.Errorf("open PhysicalDrive%d writable behind target-volume lease: %v", expected.DiskNumber, callErr)
	}

	closeOnError := func() {
		procCloseHandle.Call(handle)
	}
	if err := verifyOpenedPhysicalHandle(expected, handle); err != nil {
		closeOnError()
		return nil, fmt.Errorf("verify writable PhysicalDrive%d identity: %w", expected.DiskNumber, err)
	}

	// Recheck the same managed lease immediately before handing the writable
	// handle to a caller. The current writer is single-threaded; this second
	// check also prevents a future refactor from silently accepting an already
	// released lease after host-handle setup.
	if _, err := validateManagedTargetVolumeLease(expected, managed); err != nil {
		closeOnError()
		return nil, fmt.Errorf("revalidate target-volume lease after writable handle open: %w", err)
	}

	file := os.NewFile(handle, path)
	if file == nil {
		closeOnError()
		return nil, fmt.Errorf("wrap verified writable PhysicalDrive%d handle", expected.DiskNumber)
	}
	return file, nil
}
