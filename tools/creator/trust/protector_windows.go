//go:build windows

package trust

import (
	"errors"
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

const cryptProtectUIForbidden = 0x1

var (
	crypt32                = syscall.NewLazyDLL("crypt32.dll")
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
	dpapiEntropy           = []byte("OrdaX Creator release signing identity v1")
)

type dataBlob struct {
	Size uint32
	Data *byte
}

func blobFor(data []byte) dataBlob {
	if len(data) == 0 {
		return dataBlob{}
	}
	return dataBlob{Size: uint32(len(data)), Data: &data[0]}
}

func dpapiError(operation string, callErr error) error {
	if errno, ok := callErr.(syscall.Errno); ok && errno == 0 {
		return errors.New(operation + " failed")
	}
	if callErr == nil {
		return errors.New(operation + " failed")
	}
	return fmt.Errorf("%s: %w", operation, callErr)
}

func copyAndFree(blob dataBlob) []byte {
	if blob.Data == nil || blob.Size == 0 {
		return nil
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(blob.Data)))
	view := unsafe.Slice(blob.Data, int(blob.Size))
	return append([]byte(nil), view...)
}

func protectPrivateKey(plain []byte) ([]byte, string, error) {
	if len(plain) == 0 {
		return nil, "", errors.New("private key payload is empty")
	}
	in := blobFor(plain)
	entropy := blobFor(dpapiEntropy)
	var out dataBlob
	result, _, callErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	runtime.KeepAlive(plain)
	runtime.KeepAlive(dpapiEntropy)
	if result == 0 {
		return nil, "", dpapiError("CryptProtectData", callErr)
	}
	protected := copyAndFree(out)
	if len(protected) == 0 {
		return nil, "", errors.New("Windows DPAPI returned an empty protected key")
	}
	return protected, "windows-dpapi-current-user", nil
}

func unprotectPrivateKey(protected []byte) ([]byte, string, error) {
	if len(protected) == 0 {
		return nil, "", errors.New("protected private key is empty")
	}
	in := blobFor(protected)
	entropy := blobFor(dpapiEntropy)
	var out dataBlob
	result, _, callErr := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	runtime.KeepAlive(protected)
	runtime.KeepAlive(dpapiEntropy)
	if result == 0 {
		return nil, "", dpapiError("CryptUnprotectData", callErr)
	}
	plain := copyAndFree(out)
	if len(plain) == 0 {
		return nil, "", errors.New("Windows DPAPI returned an empty private key")
	}
	return plain, "windows-dpapi-current-user", nil
}
