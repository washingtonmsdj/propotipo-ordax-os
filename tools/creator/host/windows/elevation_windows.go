//go:build windows

package windowsadapter

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	tokenQueryAccess       uintptr = 0x0008
	tokenElevationInfoClass uintptr = 20
)

var (
	advapi32                = syscall.NewLazyDLL("advapi32.dll")
	procOpenProcessToken    = advapi32.NewProc("OpenProcessToken")
	procGetTokenInformation = advapi32.NewProc("GetTokenInformation")
	procGetCurrentProcess   = kernel32.NewProc("GetCurrentProcess")
)

func decodeTokenElevation(value uint32, returned uint32) (bool, error) {
	if returned < uint32(unsafe.Sizeof(value)) {
		return false, fmt.Errorf("short TOKEN_ELEVATION response: returned=%d", returned)
	}
	return value != 0, nil
}

// currentProcessElevated reports whether the process token itself is elevated.
// This intentionally does not test mere membership in the Administrators
// group: under UAC an administrator can run with a limited token, which is not
// sufficient for the future direct-volume/raw-disk boundary.
func currentProcessElevated() (bool, error) {
	process, _, _ := procGetCurrentProcess.Call()
	if process == 0 {
		return false, fmt.Errorf("GetCurrentProcess returned a null pseudo-handle")
	}

	var token uintptr
	result, _, callErr := procOpenProcessToken.Call(
		process,
		tokenQueryAccess,
		uintptr(unsafe.Pointer(&token)),
	)
	if result == 0 {
		return false, fmt.Errorf("OpenProcessToken(TOKEN_QUERY): %v", callErr)
	}
	defer procCloseHandle.Call(token)

	var elevation uint32
	var returned uint32
	result, _, callErr = procGetTokenInformation.Call(
		token,
		tokenElevationInfoClass,
		uintptr(unsafe.Pointer(&elevation)),
		unsafe.Sizeof(elevation),
		uintptr(unsafe.Pointer(&returned)),
	)
	if result == 0 {
		return false, fmt.Errorf("GetTokenInformation(TokenElevation): %v", callErr)
	}
	return decodeTokenElevation(elevation, returned)
}
