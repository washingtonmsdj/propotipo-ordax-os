//go:build windows

package windowsadapter

import (
	"encoding/binary"
	"fmt"
	"unsafe"
)

// queryOpenedPhysicalIdentity reads identity from an already-opened
// PhysicalDrive handle. It is deliberately metadata-only: callers remain
// responsible for how the handle was opened, and this helper never locks,
// dismounts or writes the device.
func queryOpenedPhysicalIdentity(handle uintptr) (openedPhysicalIdentity, error) {
	if handle == 0 || handle == ^uintptr(0) {
		return openedPhysicalIdentity{}, fmt.Errorf("invalid PhysicalDrive handle")
	}

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
		return openedPhysicalIdentity{}, fmt.Errorf("query opened PhysicalDrive device number: %v", ioctlErr)
	}
	if returned < uint32(unsafe.Sizeof(number)) {
		return openedPhysicalIdentity{}, fmt.Errorf("short STORAGE_DEVICE_NUMBER response from opened PhysicalDrive")
	}

	query := make([]byte, 12)
	descriptor := make([]byte, 4096)
	returned = 0
	result, _, ioctlErr = procDeviceIoControl.Call(
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
		return openedPhysicalIdentity{}, fmt.Errorf("query opened PhysicalDrive storage identity: %v", ioctlErr)
	}
	if returned < 36 {
		return openedPhysicalIdentity{}, fmt.Errorf("short STORAGE_DEVICE_DESCRIPTOR response from opened PhysicalDrive")
	}
	busType := binary.LittleEndian.Uint32(descriptor[28:32])
	serialOffset := binary.LittleEndian.Uint32(descriptor[24:28])
	deviceRemovable := descriptor[10] != 0
	deviceSerial := descriptorString(descriptor, returned, serialOffset)

	geometry := make([]byte, 64)
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
		return openedPhysicalIdentity{}, fmt.Errorf("query opened PhysicalDrive capacity: %v", ioctlErr)
	}
	if returned < 32 {
		return openedPhysicalIdentity{}, fmt.Errorf("short DISK_GEOMETRY_EX response from opened PhysicalDrive")
	}
	diskBytes := binary.LittleEndian.Uint64(geometry[24:32])
	if diskBytes == 0 {
		return openedPhysicalIdentity{}, fmt.Errorf("opened PhysicalDrive reported zero capacity")
	}

	return openedPhysicalIdentity{
		DiskNumber:        number.DeviceNumber,
		PhysicalDiskBytes: diskBytes,
		BusType:           busType,
		DeviceRemovable:   deviceRemovable,
		DeviceSerial:      deviceSerial,
	}, nil
}

func verifyOpenedPhysicalHandle(expected Target, handle uintptr) error {
	actual, err := queryOpenedPhysicalIdentity(handle)
	if err != nil {
		return err
	}
	if err := validateOpenedPhysicalIdentity(expected, actual); err != nil {
		return fmt.Errorf("opened PhysicalDrive identity verification failed: %w", err)
	}
	return nil
}
