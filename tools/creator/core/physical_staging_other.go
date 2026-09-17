//go:build !windows

package creatorcore

import "os"

func configurePhysicalImageStaging(file *os.File) error {
	return nil
}
