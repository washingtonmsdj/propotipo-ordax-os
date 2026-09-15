//go:build windows

package windowsadapter

import (
	"fmt"
	"os"
	"unsafe"
)

const genericReadRawImage uintptr = 0x80000000

// openRawImageReadLocked opens the source with read sharing only. Windows share
// checks are symmetric, so this fails if another existing handle has write
// access and prevents new write/delete handles while the raw apply keeps this
// handle open. The caller still verifies regular-file identity, size and hash.
func openRawImageReadLocked(path string) (*os.File, error) {
	ptr, err := utf16Ptr(path)
	if err != nil {
		return nil, err
	}
	handle, _, callErr := procCreateFileW.Call(
		uintptr(unsafe.Pointer(ptr)),
		genericReadRawImage,
		fileShareRead,
		0,
		openExisting,
		0,
		0,
	)
	if handle == ^uintptr(0) {
		return nil, fmt.Errorf("open raw image with write sharing denied: %v", callErr)
	}
	file := os.NewFile(handle, path)
	if file == nil {
		procCloseHandle.Call(handle)
		return nil, fmt.Errorf("wrap raw image Windows handle")
	}
	return file, nil
}
