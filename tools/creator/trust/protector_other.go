//go:build !windows

package trust

import "errors"

func protectPrivateKey([]byte) ([]byte, string, error) {
	return nil, "", errors.New("local release identity protection requires Windows")
}

func unprotectPrivateKey([]byte) ([]byte, string, error) {
	return nil, "", errors.New("local release identity protection requires Windows")
}
