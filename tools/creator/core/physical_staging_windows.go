//go:build windows

package creatorcore

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const fsctlSetSparse = 0x000900C4

var (
	physicalStagingKernel32       = syscall.NewLazyDLL("kernel32.dll")
	physicalStagingDeviceIoControl = physicalStagingKernel32.NewProc("DeviceIoControl")
)

// configurePhysicalImageStaging marks the target-sized preparation file as an
// NTFS sparse file before it is extended to the physical USB capacity. The
// Creator writes only the canonical seed and a few target-specific GPT/data
// regions, so reserving tens of gigabytes on the Windows system drive is both
// unnecessary and harmful.
func configurePhysicalImageStaging(file *os.File) error {
	if file == nil {
		return errors.New("staging file is nil")
	}
	var returned uint32
	ok, _, callErr := physicalStagingDeviceIoControl.Call(
		file.Fd(),
		uintptr(fsctlSetSparse),
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&returned)),
		0,
	)
	if ok == 0 {
		return fmt.Errorf("mark Windows staging file sparse: %w", callErr)
	}
	return nil
}
