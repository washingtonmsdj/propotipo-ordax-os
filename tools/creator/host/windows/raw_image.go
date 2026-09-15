package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

type VerifiedRawImage struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
}

type RawDiskApplyRequest struct {
	Target                   Target           `json:"target"`
	ConfirmationToken        string           `json:"confirmation_token"`
	Image                    VerifiedRawImage `json:"image"`
	CanonicalTrustResolved   bool             `json:"canonical_trust_resolved"`
	DestructiveAuthorization string           `json:"destructive_authorization"`
}

func validLowerSHA256(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func VerifyRawImage(path string, expectedSHA256 string, expectedSizeBytes int64) (VerifiedRawImage, error) {
	if path == "" {
		return VerifiedRawImage{}, errors.New("raw image path is required")
	}
	if !validLowerSHA256(expectedSHA256) {
		return VerifiedRawImage{}, errors.New("expected raw image SHA-256 must be lowercase 64-hex")
	}
	if expectedSizeBytes <= 0 {
		return VerifiedRawImage{}, errors.New("expected raw image size must be positive")
	}

	info, err := os.Lstat(path)
	if err != nil {
		return VerifiedRawImage{}, fmt.Errorf("stat raw image: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return VerifiedRawImage{}, errors.New("raw image must be a regular non-symlink file")
	}
	if info.Size() != expectedSizeBytes {
		return VerifiedRawImage{}, fmt.Errorf("raw image size mismatch: expected=%d actual=%d", expectedSizeBytes, info.Size())
	}

	file, err := os.Open(path)
	if err != nil {
		return VerifiedRawImage{}, fmt.Errorf("open raw image: %w", err)
	}
	defer file.Close()

	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return VerifiedRawImage{}, fmt.Errorf("hash raw image: %w", err)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA256 {
		return VerifiedRawImage{}, fmt.Errorf("raw image SHA-256 mismatch: expected=%s actual=%s", expectedSHA256, actual)
	}

	return VerifiedRawImage{
		Path:      path,
		SizeBytes: info.Size(),
		SHA256:    actual,
	}, nil
}

func DestructiveAuthorizationToken(target Target, image VerifiedRawImage) string {
	identity := strings.Join([]string{
		"ordax-destructive-write-v1",
		target.ConfirmationToken,
		image.SHA256,
		strconv.FormatInt(image.SizeBytes, 10),
	}, "|")
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func ValidateRawDiskApplyRequest(request RawDiskApplyRequest) error {
	confirmed, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken)
	if err != nil {
		return err
	}
	if confirmed.SystemDisk || confirmed.BusType != "usb" || !confirmed.PrototypeSafe {
		return errors.New("target is not eligible for physical write")
	}
	if !request.CanonicalTrustResolved {
		return errors.New("physical write blocked: canonical release trust is unresolved")
	}

	verified, err := VerifyRawImage(request.Image.Path, request.Image.SHA256, request.Image.SizeBytes)
	if err != nil {
		return err
	}
	if verified.SizeBytes <= 0 {
		return errors.New("verified raw image is empty")
	}

	expectedAuthorization := DestructiveAuthorizationToken(confirmed, verified)
	if request.DestructiveAuthorization != expectedAuthorization {
		return errors.New("physical write blocked: destructive authorization does not match current target and image")
	}
	return nil
}

func streamRawImageVerified(source io.Reader, destination io.Writer, expectedSHA256 string, expectedSizeBytes int64) (int64, error) {
	if !validLowerSHA256(expectedSHA256) || expectedSizeBytes <= 0 {
		return 0, errors.New("invalid expected raw image identity")
	}

	digest := sha256.New()
	reader := io.TeeReader(io.LimitReader(source, expectedSizeBytes+1), digest)
	written, err := io.Copy(destination, reader)
	if err != nil {
		return written, fmt.Errorf("stream raw image: %w", err)
	}
	if written != expectedSizeBytes {
		return written, fmt.Errorf("raw image changed while streaming: expected=%d actual=%d", expectedSizeBytes, written)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA256 {
		return written, fmt.Errorf("raw image changed while streaming: expected SHA-256=%s actual=%s", expectedSHA256, actual)
	}
	return written, nil
}
