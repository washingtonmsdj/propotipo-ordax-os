//go:build windows

package windowsadapter

import (
	"encoding/binary"
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

const (
	ioctlVolumeGetVolumeDiskExtents uintptr       = 0x00560000
	errorMoreData                   syscall.Errno = 234
	errorNoMoreFiles                syscall.Errno = 18
	maxVolumeExtentsBuffer                        = 1 << 20
)

var (
	procFindFirstVolumeW                  = kernel32.NewProc("FindFirstVolumeW")
	procFindNextVolumeW                   = kernel32.NewProc("FindNextVolumeW")
	procFindVolumeClose                   = kernel32.NewProc("FindVolumeClose")
	procGetVolumeNameForVolumeMountPointW = kernel32.NewProc("GetVolumeNameForVolumeMountPointW")
)

func callErrno(err error) syscall.Errno {
	if errno, ok := err.(syscall.Errno); ok {
		return errno
	}
	return 0
}

func queryVolumeDiskNumbersReadOnly(volumeName string) ([]uint32, error) {
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
		0,
		fileShareRead|fileShareWrite,
		0,
		openExisting,
		0,
		0,
	)
	if handle == ^uintptr(0) {
		return nil, fmt.Errorf("open volume %s for read-only extent inventory: %v", volumeName, callErr)
	}
	defer procCloseHandle.Call(handle)

	buffer := make([]byte, volumeDiskExtentsHeaderBytes+diskExtentBytes)
	for attempt := 0; attempt < 2; attempt++ {
		var returned uint32
		result, _, ioctlErr := procDeviceIoControl.Call(
			handle,
			ioctlVolumeGetVolumeDiskExtents,
			0,
			0,
			uintptr(unsafe.Pointer(&buffer[0])),
			uintptr(len(buffer)),
			uintptr(unsafe.Pointer(&returned)),
			0,
		)
		if result != 0 {
			return parseVolumeDiskNumbers(buffer, returned)
		}
		if callErrno(ioctlErr) != errorMoreData {
			return nil, fmt.Errorf("query volume %s disk extents: %v", volumeName, ioctlErr)
		}
		if len(buffer) < volumeDiskExtentsHeaderBytes {
			return nil, fmt.Errorf("volume %s returned ERROR_MORE_DATA without extent header", volumeName)
		}
		count := binary.LittleEndian.Uint32(buffer[:4])
		if count <= 1 {
			return nil, fmt.Errorf("volume %s returned ERROR_MORE_DATA with invalid extent count %d", volumeName, count)
		}
		needed := uint64(volumeDiskExtentsHeaderBytes) + uint64(count)*uint64(diskExtentBytes)
		if needed > maxVolumeExtentsBuffer {
			return nil, fmt.Errorf("volume %s extent inventory exceeds safety bound: count=%d bytes=%d", volumeName, count, needed)
		}
		buffer = make([]byte, int(needed))
	}
	return nil, fmt.Errorf("volume %s extent inventory remained unstable after resize", volumeName)
}

func enumerateAllPhysicalVolumesReadOnly() ([]physicalVolume, error) {
	buffer := make([]uint16, 1024)
	search, _, callErr := procFindFirstVolumeW.Call(
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)
	if search == ^uintptr(0) {
		return nil, fmt.Errorf("FindFirstVolumeW failed: %v", callErr)
	}
	defer procFindVolumeClose.Call(search)

	volumes := make([]physicalVolume, 0, 8)
	for {
		volumeName := syscall.UTF16ToString(buffer)
		if strings.TrimSpace(volumeName) == "" {
			return nil, fmt.Errorf("Windows volume enumeration returned an empty volume name")
		}
		disks, err := queryVolumeDiskNumbersReadOnly(volumeName)
		if err != nil {
			return nil, err
		}
		volumes = append(volumes, physicalVolume{
			VolumeName:  volumeName,
			DiskNumbers: disks,
		})

		for index := range buffer {
			buffer[index] = 0
		}
		result, _, nextErr := procFindNextVolumeW.Call(
			search,
			uintptr(unsafe.Pointer(&buffer[0])),
			uintptr(len(buffer)),
		)
		if result != 0 {
			continue
		}
		if callErrno(nextErr) == errorNoMoreFiles {
			break
		}
		return nil, fmt.Errorf("FindNextVolumeW failed: %v", nextErr)
	}
	return volumes, nil
}

func targetMountVolumeName(driveLetter string) (string, error) {
	root := strings.ToUpper(strings.TrimSpace(driveLetter)) + `\`
	rootPtr, err := utf16Ptr(root)
	if err != nil {
		return "", err
	}
	buffer := make([]uint16, 1024)
	result, _, callErr := procGetVolumeNameForVolumeMountPointW.Call(
		uintptr(unsafe.Pointer(rootPtr)),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)
	if result == 0 {
		return "", fmt.Errorf("resolve volume GUID for %s: %v", root, callErr)
	}
	volumeName := syscall.UTF16ToString(buffer)
	if _, err := normalizeVolumeNameForOpen(volumeName); err != nil {
		return "", fmt.Errorf("invalid volume GUID returned for %s: %w", root, err)
	}
	return volumeName, nil
}

// enumerateTargetPhysicalVolumesReadOnly closes TOCTOU-adjacent read-only
// proofs without performing a destructive action: the PhysicalDrive is opened
// with GENERIC_READ and identity-verified, then every Windows volume is mapped
// through IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS. Any volume that crosses from
// the selected disk onto another physical disk fails closed. The already-known
// drive-letter volume must also be present in the isolated inventory.
func enumerateTargetPhysicalVolumesReadOnly(expected Target) ([]physicalVolume, error) {
	if err := validateExpectedPhysicalTarget(expected); err != nil {
		return nil, err
	}
	if err := verifyPhysicalDriveReadOnly(expected); err != nil {
		return nil, fmt.Errorf("verify target PhysicalDrive read-only before volume inventory: %w", err)
	}

	allVolumes, err := enumerateAllPhysicalVolumesReadOnly()
	if err != nil {
		return nil, fmt.Errorf("enumerate Windows volumes: %w", err)
	}
	if err := validateTargetVolumeIsolation(allVolumes, expected.DiskNumber); err != nil {
		return nil, fmt.Errorf("target PhysicalDrive volume ownership is not isolated: %w", err)
	}
	selected := selectPhysicalDiskVolumes(allVolumes, expected.DiskNumber)
	knownVolume, err := targetMountVolumeName(expected.DriveLetter)
	if err != nil {
		return nil, err
	}
	if !volumeInventoryContainsName(selected, knownVolume) {
		return nil, fmt.Errorf("target mount volume %s is missing from PhysicalDrive%d extent inventory", knownVolume, expected.DiskNumber)
	}
	return selected, nil
}
