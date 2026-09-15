//go:build windows

package windowsadapter

import (
	"fmt"
	"sort"
	"syscall"
	"unsafe"
)

const (
	driveRemovable               = 2
	fileShareRead         uintptr = 0x00000001
	fileShareWrite        uintptr = 0x00000002
	openExisting          uintptr = 3
	ioctlStorageGetDeviceNumber  = 0x002d1080
)

type storageDeviceNumber struct {
	DeviceType      uint32
	DeviceNumber    uint32
	PartitionNumber uint32
}

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGetLogicalDrives      = kernel32.NewProc("GetLogicalDrives")
	procGetDriveTypeW         = kernel32.NewProc("GetDriveTypeW")
	procGetVolumeInformationW = kernel32.NewProc("GetVolumeInformationW")
	procGetDiskFreeSpaceExW   = kernel32.NewProc("GetDiskFreeSpaceExW")
	procCreateFileW           = kernel32.NewProc("CreateFileW")
	procDeviceIoControl       = kernel32.NewProc("DeviceIoControl")
	procCloseHandle           = kernel32.NewProc("CloseHandle")
)

func utf16Ptr(value string) (*uint16, error) {
	return syscall.UTF16PtrFromString(value)
}

func driveType(root string) (uint32, error) {
	ptr, err := utf16Ptr(root)
	if err != nil {
		return 0, err
	}
	value, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(ptr)))
	if value == 0 {
		return 0, fmt.Errorf("GetDriveTypeW failed for %s", root)
	}
	return uint32(value), nil
}

func volumeIdentity(root string) (string, uint32) {
	ptr, err := utf16Ptr(root)
	if err != nil {
		return "", 0
	}
	buffer := make([]uint16, 261)
	var serial uint32
	result, _, _ := procGetVolumeInformationW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
		uintptr(unsafe.Pointer(&serial)),
		0, 0, 0, 0,
	)
	if result == 0 {
		return "", 0
	}
	return syscall.UTF16ToString(buffer), serial
}

func volumeBytes(root string) uint64 {
	ptr, err := utf16Ptr(root)
	if err != nil {
		return 0
	}
	var freeAvailable uint64
	var total uint64
	var totalFree uint64
	result, _, _ := procGetDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&freeAvailable)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if result == 0 {
		return 0
	}
	return total
}

func physicalDiskNumber(driveLetter string) (uint32, error) {
	path := `\\.\` + driveLetter
	ptr, err := utf16Ptr(path)
	if err != nil {
		return 0, err
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
		return 0, fmt.Errorf("open removable volume %s read-only: %v", driveLetter, callErr)
	}
	defer procCloseHandle.Call(handle)

	var number storageDeviceNumber
	var returned uint32
	result, _, ioctlErr := procDeviceIoControl.Call(
		handle,
		ioctlStorageGetDeviceNumber,
		0,
		0,
		uintptr(unsafe.Pointer(&number)),
		unsafe.Sizeof(number),
		uintptr(unsafe.Pointer(&returned)),
		0,
	)
	if result == 0 {
		return 0, fmt.Errorf("map removable volume %s to physical disk: %v", driveLetter, ioctlErr)
	}
	if returned < uint32(unsafe.Sizeof(number)) {
		return 0, fmt.Errorf("short STORAGE_DEVICE_NUMBER response for %s", driveLetter)
	}
	return number.DeviceNumber, nil
}

// EnumerateRemovableTargets is intentionally read-only. It only considers
// Win32 DRIVE_REMOVABLE volumes during this prototype phase and maps them to
// their physical-disk number. Fixed-media USB devices are not accepted yet.
func EnumerateRemovableTargets() ([]Target, error) {
	mask, _, callErr := procGetLogicalDrives.Call()
	if mask == 0 {
		return nil, fmt.Errorf("GetLogicalDrives failed: %v", callErr)
	}

	seenDisk := map[uint32]bool{}
	targets := make([]Target, 0, 4)
	for index := 0; index < 26; index++ {
		if mask&(1<<index) == 0 {
			continue
		}
		letter := string(rune('A'+index)) + ":"
		root := letter + `\`
		typeValue, err := driveType(root)
		if err != nil || typeValue != driveRemovable {
			continue
		}
		diskNumber, err := physicalDiskNumber(letter)
		if err != nil {
			return nil, err
		}
		if seenDisk[diskNumber] {
			continue
		}
		seenDisk[diskNumber] = true
		label, serial := volumeIdentity(root)
		target := Target{
			DriveLetter: letter,
			VolumeLabel: label,
			VolumeSerial: serial,
			DiskNumber:  diskNumber,
			VolumeBytes: volumeBytes(root),
			DriveType:   "removable",
		}
		targets = append(targets, FinalizeTarget(target, typeValue, true))
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].DiskNumber == targets[j].DiskNumber {
			return targets[i].DriveLetter < targets[j].DriveLetter
		}
		return targets[i].DiskNumber < targets[j].DiskNumber
	})
	return targets, nil
}
