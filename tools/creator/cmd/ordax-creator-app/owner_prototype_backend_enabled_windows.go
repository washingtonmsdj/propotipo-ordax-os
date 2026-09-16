//go:build windows && ordax_owner_prototype

package main

import (
	"os"
	"path/filepath"
)

// ownerPrototypePhysicalBackend is intentionally available only in builds
// compiled with the ordax_owner_prototype tag. It never scans arbitrary paths:
// the executable, raw backend and seed image must be regular non-symlink files
// in the exact same directory.
func ownerPrototypePhysicalBackend() (string, bool) {
	executable, err := os.Executable()
	if err != nil {
		return "", false
	}
	directory := filepath.Dir(executable)
	for _, name := range []string{"ordax-creator-physical-test.exe", "ordax-bootstrap-seed.raw"} {
		info, err := os.Lstat(filepath.Join(directory, name))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return "", false
		}
	}
	return directory, true
}
