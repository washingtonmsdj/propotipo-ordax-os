package windowsadapter

import (
	"errors"
	"fmt"
	"os"
)

// openStableRawImageForApply binds the path, file identity and exact logical
// size to the same write-locked handle that will be used for write-plan hashing
// and raw streaming. Unlike the legacy full-image verifier, it deliberately
// does not hash capacity-only sparse space.
func openStableRawImageForApply(path string, expectedSizeBytes int64) (*os.File, VerifiedRawImage, error) {
	if path == "" {
		return nil, VerifiedRawImage{}, errors.New("raw image path is required")
	}
	if expectedSizeBytes <= 0 {
		return nil, VerifiedRawImage{}, errors.New("expected raw image size must be positive")
	}

	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, VerifiedRawImage{}, fmt.Errorf("stat raw image: %w", err)
	}
	if pathInfo.Mode()&os.ModeSymlink != 0 || !pathInfo.Mode().IsRegular() {
		return nil, VerifiedRawImage{}, errors.New("raw image must be a regular non-symlink file")
	}

	file, err := openRawImageReadLocked(path)
	if err != nil {
		return nil, VerifiedRawImage{}, fmt.Errorf("open raw image: %w", err)
	}
	closeOnError := func(cause error) (*os.File, VerifiedRawImage, error) {
		_ = file.Close()
		return nil, VerifiedRawImage{}, cause
	}

	handleInfo, err := file.Stat()
	if err != nil {
		return closeOnError(fmt.Errorf("stat opened raw image: %w", err))
	}
	if !handleInfo.Mode().IsRegular() {
		return closeOnError(errors.New("opened raw image handle is not a regular file"))
	}
	if !os.SameFile(pathInfo, handleInfo) {
		return closeOnError(errors.New("raw image path changed while opening stable handle"))
	}
	if handleInfo.Size() != expectedSizeBytes {
		return closeOnError(fmt.Errorf("raw image size mismatch: expected=%d actual=%d", expectedSizeBytes, handleInfo.Size()))
	}
	return file, VerifiedRawImage{Path: path, SizeBytes: handleInfo.Size()}, nil
}
