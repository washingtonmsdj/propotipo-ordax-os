//go:build !windows

package windowsadapter

import "os"

// Non-Windows builds exist for policy/unit tests only. The physical writer is
// Windows-specific; os.Open is sufficient here because no native destructive
// backend is available on these platforms.
func openRawImageReadLocked(path string) (*os.File, error) {
	return os.Open(path)
}
