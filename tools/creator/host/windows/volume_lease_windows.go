//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"errors"
	"fmt"
	"unsafe"
)

const (
	genericWriteVolume uintptr = 0x40000000

	// winioctl.h: CTL_CODE(FILE_DEVICE_FILE_SYSTEM, function,
	// METHOD_BUFFERED, FILE_ANY_ACCESS). Keeping the formula visible avoids
	// unexplained magic values while matching the Windows SDK definitions.
	fileDeviceFileSystem uintptr = 0x00000009
	fsctlLockVolume      uintptr = (fileDeviceFileSystem << 16) | (6 << 2)
	fsctlUnlockVolume    uintptr = (fileDeviceFileSystem << 16) | (7 << 2)
	fsctlDismountVolume  uintptr = (fileDeviceFileSystem << 16) | (8 << 2)
)

type windowsLockedVolumeHandle struct {
	name       string
	handle     uintptr
	locked     bool
	dismounted bool
	closed     bool
}

var _ targetVolumeLeaseHandle = (*windowsLockedVolumeHandle)(nil)

func deviceIoControlNoBuffers(handle uintptr, controlCode uintptr) error {
	if handle == 0 || handle == ^uintptr(0) {
		return errors.New("invalid Windows volume handle")
	}
	var returned uint32
	result, _, callErr := procDeviceIoControl.Call(
		handle,
		controlCode,
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&returned)),
		0,
	)
	if result == 0 {
		return callErr
	}
	return nil
}

// openLockedWindowsVolume is an unexported native primitive compiled only with
// the explicit ordax_raw_backend tag. It opens the GUID volume object for
// direct access and immediately requests FSCTL_LOCK_VOLUME. The host-neutral
// lease policy re-proves physical extents on this exact returned handle before
// allowing the dismount boundary to continue.
func openLockedWindowsVolume(volumeName string) (*windowsLockedVolumeHandle, error) {
	openName, err := normalizeVolumeNameForOpen(volumeName)
	if err != nil {
		return nil, err
	}
	ptr, err := utf16Ptr(openName)
	if err != nil {
		return nil, err
	}

	handle, _, callErr := procCreateFileW.Call(
		uintptr(unsafe.Pointer(ptr)),
		genericReadPhysicalDrive|genericWriteVolume,
		fileShareRead|fileShareWrite,
		0,
		openExisting,
		0,
		0,
	)
	if handle == ^uintptr(0) {
		return nil, fmt.Errorf("open volume %s for exclusive lease: %v", openName, callErr)
	}

	locked := &windowsLockedVolumeHandle{name: openName, handle: handle}
	if err := deviceIoControlNoBuffers(handle, fsctlLockVolume); err != nil {
		procCloseHandle.Call(handle)
		locked.handle = ^uintptr(0)
		locked.closed = true
		return nil, fmt.Errorf("FSCTL_LOCK_VOLUME %s: %w", openName, err)
	}
	locked.locked = true
	return locked, nil
}

func (h *windowsLockedVolumeHandle) DiskNumbers() ([]uint32, error) {
	if h == nil || h.closed || h.handle == 0 || h.handle == ^uintptr(0) {
		return nil, fmt.Errorf("locked Windows volume handle is closed")
	}
	return queryVolumeDiskNumbersHandle(h.handle, h.name)
}

func (h *windowsLockedVolumeHandle) Dismount() error {
	if h == nil || h.closed || h.handle == 0 || h.handle == ^uintptr(0) {
		return fmt.Errorf("locked Windows volume handle is closed")
	}
	if !h.locked {
		return fmt.Errorf("refuse to dismount unlocked Windows volume %s", h.name)
	}
	if h.dismounted {
		return nil
	}
	if err := deviceIoControlNoBuffers(h.handle, fsctlDismountVolume); err != nil {
		return fmt.Errorf("FSCTL_DISMOUNT_VOLUME %s: %w", h.name, err)
	}
	h.dismounted = true
	return nil
}

func (h *windowsLockedVolumeHandle) Close() error {
	if h == nil || h.closed {
		return nil
	}
	h.closed = true

	var errs []error
	if h.locked && h.handle != 0 && h.handle != ^uintptr(0) {
		if err := deviceIoControlNoBuffers(h.handle, fsctlUnlockVolume); err != nil {
			errs = append(errs, fmt.Errorf("FSCTL_UNLOCK_VOLUME %s: %w", h.name, err))
		}
		h.locked = false
	}
	if h.handle != 0 && h.handle != ^uintptr(0) {
		result, _, callErr := procCloseHandle.Call(h.handle)
		if result == 0 {
			errs = append(errs, fmt.Errorf("CloseHandle volume %s: %v", h.name, callErr))
		}
		h.handle = ^uintptr(0)
	}
	return errors.Join(errs...)
}

type windowsTargetVolumeLeaseRuntime struct{}

var _ targetVolumeLeaseRuntime = windowsTargetVolumeLeaseRuntime{}

func (windowsTargetVolumeLeaseRuntime) EnumeratePhysicalVolumes() ([]physicalVolume, error) {
	return enumerateAllPhysicalVolumesReadOnly()
}

func (windowsTargetVolumeLeaseRuntime) ResolveMountVolume(driveLetter string) (string, error) {
	return targetMountVolumeName(driveLetter)
}

func (windowsTargetVolumeLeaseRuntime) OpenLockedVolume(volumeName string) (targetVolumeLeaseHandle, error) {
	return openLockedWindowsVolume(volumeName)
}

func (windowsTargetVolumeLeaseRuntime) EnumerateVolumeNames() ([]string, error) {
	return enumerateWindowsVolumeNames()
}

func (windowsTargetVolumeLeaseRuntime) QueryVolumeDisksReadOnly(volumeName string) ([]uint32, error) {
	return queryVolumeDiskNumbersReadOnly(volumeName)
}
