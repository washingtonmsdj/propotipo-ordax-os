//go:build windows

package windowsadapter

import (
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
	"syscall"
	"unsafe"
)

const (
	fileShareRead                   uintptr = 0x00000001
	fileShareWrite                  uintptr = 0x00000002
	openExisting                    uintptr = 3
	ioctlDiskGetDriveGeometryEx             = 0x000700A0
	ioctlStorageGetDeviceNumber             = 0x002d1080
	ioctlStorageQueryProperty               = 0x002d1400
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
	procGetWindowsDirectoryW  = kernel32.NewProc("GetWindowsDirectoryW")
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
		return 0, fmt.Errorf("open volume %s for read-only metadata: %v", driveLetter, callErr)
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
		return 0, fmt.Errorf("map volume %s to physical disk: %v", driveLetter, ioctlErr)
	}
	if returned < uint32(unsafe.Sizeof(number)) {
		return 0, fmt.Errorf("short STORAGE_DEVICE_NUMBER response for %s", driveLetter)
	}
	return number.DeviceNumber, nil
}

func descriptorString(buffer []byte, returned uint32, offset uint32) string {
	if offset == 0 || offset >= returned || int(offset) >= len(buffer) {
		return ""
	}
	end := int(offset)
	limit := int(returned)
	if limit > len(buffer) {
		limit = len(buffer)
	}
	for end < limit && buffer[end] != 0 {
		end++
	}
	return strings.TrimSpace(string(buffer[int(offset):end]))
}

func physicalDeviceIdentity(diskNumber uint32) (uint32, bool, string, uint64, error) {
	path := fmt.Sprintf(`\\.\PhysicalDrive%d`, diskNumber)
	ptr, err := utf16Ptr(path)
	if err != nil {
		return 0, false, "", 0, err
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
		return 0, false, "", 0, fmt.Errorf("open PhysicalDrive%d for read-only metadata: %v", diskNumber, callErr)
	}
	defer procCloseHandle.Call(handle)

	// STORAGE_PROPERTY_QUERY with PropertyId=StorageDeviceProperty and
	// QueryType=PropertyStandardQuery is all-zero bytes.
	query := make([]byte, 12)
	descriptor := make([]byte, 4096)
	var returned uint32
	result, _, ioctlErr := procDeviceIoControl.Call(
		handle,
		ioctlStorageQueryProperty,
		uintptr(unsafe.Pointer(&query[0])),
		uintptr(len(query)),
		uintptr(unsafe.Pointer(&descriptor[0])),
		uintptr(len(descriptor)),
		uintptr(unsafe.Pointer(&returned)),
		0,
	)
	if result == 0 {
		return 0, false, "", 0, fmt.Errorf("query PhysicalDrive%d storage identity: %v", diskNumber, ioctlErr)
	}
	if returned < 36 {
		return 0, false, "", 0, fmt.Errorf("short STORAGE_DEVICE_DESCRIPTOR response for PhysicalDrive%d", diskNumber)
	}
	busType := binary.LittleEndian.Uint32(descriptor[28:32])
	serialOffset := binary.LittleEndian.Uint32(descriptor[24:28])
	deviceRemovable := descriptor[10] != 0
	deviceSerial := descriptorString(descriptor, returned, serialOffset)

	// DISK_GEOMETRY_EX begins with a 24-byte DISK_GEOMETRY followed by the
	// 64-bit DiskSize. We only consume that fixed prefix and keep discovery
	// read-only.
	geometry := make([]byte, 32)
	returned = 0
	result, _, ioctlErr = procDeviceIoControl.Call(
		handle,
		ioctlDiskGetDriveGeometryEx,
		0,
		0,
		uintptr(unsafe.Pointer(&geometry[0])),
		uintptr(len(geometry)),
		uintptr(unsafe.Pointer(&returned)),
		0,
	)
	if result == 0 {
		return 0, false, "", 0, fmt.Errorf("query PhysicalDrive%d capacity: %v", diskNumber, ioctlErr)
	}
	if returned < 32 {
		return 0, false, "", 0, fmt.Errorf("short DISK_GEOMETRY_EX response for PhysicalDrive%d", diskNumber)
	}
	diskBytes := binary.LittleEndian.Uint64(geometry[24:32])
	if diskBytes == 0 {
		return 0, false, "", 0, fmt.Errorf("PhysicalDrive%d reported zero capacity", diskNumber)
	}

	return busType, deviceRemovable, deviceSerial, diskBytes, nil
}

func windowsSystemDiskNumber() (uint32, error) {
	buffer := make([]uint16, 32768)
	result, _, callErr := procGetWindowsDirectoryW.Call(
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)
	if result == 0 || result >= uintptr(len(buffer)) {
		return 0, fmt.Errorf("GetWindowsDirectoryW failed: %v", callErr)
	}
	windowsPath := syscall.UTF16ToString(buffer[:result])
	if len(windowsPath) < 2 || windowsPath[1] != ':' {
		return 0, fmt.Errorf("unexpected Windows directory path %q", windowsPath)
	}
	return physicalDiskNumber(strings.ToUpper(windowsPath[:2]))
}

// EnumerateRemovableTargets is intentionally read-only. A candidate may be
// reported by Windows as DRIVE_REMOVABLE or DRIVE_FIXED, but it is considered
// for the prototype only after its PhysicalDrive descriptor proves BusType=USB
// and its physical capacity is measured directly from the same device handle.
// The physical disk hosting the running Windows installation is always marked
// unsafe even if Windows itself is booted from USB.
func EnumerateRemovableTargets() ([]Target, error) {
	mask, _, callErr := procGetLogicalDrives.Call()
	if mask == 0 {
		return nil, fmt.Errorf("GetLogicalDrives failed: %v", callErr)
	}
	systemDiskNumber, err := windowsSystemDiskNumber()
	if err != nil {
		return nil, fmt.Errorf("cannot establish Windows system disk identity: %w", err)
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
		if err != nil || (typeValue != DriveTypeRemovable && typeValue != DriveTypeFixed) {
			continue
		}
		diskNumber, err := physicalDiskNumber(letter)
		if err != nil {
			continue
		}
		busType, deviceRemovable, deviceSerial, diskBytes, err := physicalDeviceIdentity(diskNumber)
		if err != nil || busType != BusTypeUSB || diskBytes == 0 {
			continue
		}
		if seenDisk[diskNumber] {
			continue
		}
		seenDisk[diskNumber] = true
		label, serial := volumeIdentity(root)
		target := Target{
			DriveLetter:       letter,
			VolumeLabel:       label,
			VolumeSerial:      serial,
			DiskNumber:        diskNumber,
			VolumeBytes:       volumeBytes(root),
			PhysicalDiskBytes: diskBytes,
			DeviceRemovable:   deviceRemovable,
			DeviceSerial:      deviceSerial,
		}
		targets = append(targets, FinalizeTarget(target, typeValue, true, busType, diskNumber == systemDiskNumber))
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].DiskNumber == targets[j].DiskNumber {
			return targets[i].DriveLetter < targets[j].DriveLetter
		}
		return targets[i].DiskNumber < targets[j].DiskNumber
	})
	return targets, nil
}
