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
	BootstrapSeedBytes       int64            `json:"bootstrap_seed_bytes,omitempty"`
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

// openVerifiedRawImageForApply binds verification to the exact file handle that
// will later be streamed. On Windows openRawImageReadLocked also denies write
// sharing for the lifetime of this handle, closing the path-reopen TOCTOU gap
// before any physical device can be opened.
func openVerifiedRawImageForApply(path string, expectedSHA256 string, expectedSizeBytes int64) (*os.File, VerifiedRawImage, error) {
	if path == "" {
		return nil, VerifiedRawImage{}, errors.New("raw image path is required")
	}
	if !validLowerSHA256(expectedSHA256) {
		return nil, VerifiedRawImage{}, errors.New("expected raw image SHA-256 must be lowercase 64-hex")
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
		return closeOnError(errors.New("raw image path changed while opening verified handle"))
	}
	if handleInfo.Size() != expectedSizeBytes {
		return closeOnError(fmt.Errorf("raw image size mismatch: expected=%d actual=%d", expectedSizeBytes, handleInfo.Size()))
	}

	digest := sha256.New()
	hashed, err := io.CopyN(digest, file, expectedSizeBytes)
	if err != nil {
		return closeOnError(fmt.Errorf("hash raw image: expected=%d actual=%d: %w", expectedSizeBytes, hashed, err))
	}
	var extra [1]byte
	extraCount, extraErr := file.Read(extra[:])
	if extraCount != 0 {
		return closeOnError(errors.New("raw image grew beyond authorized size while hashing"))
	}
	if extraErr != nil && !errors.Is(extraErr, io.EOF) {
		return closeOnError(fmt.Errorf("check raw image end: %w", extraErr))
	}

	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA256 {
		return closeOnError(fmt.Errorf("raw image SHA-256 mismatch: expected=%s actual=%s", expectedSHA256, actual))
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return closeOnError(fmt.Errorf("rewind verified raw image: %w", err))
	}

	return file, VerifiedRawImage{
		Path:      path,
		SizeBytes: handleInfo.Size(),
		SHA256:    actual,
	}, nil
}

func VerifyRawImage(path string, expectedSHA256 string, expectedSizeBytes int64) (VerifiedRawImage, error) {
	file, verified, err := openVerifiedRawImageForApply(path, expectedSHA256, expectedSizeBytes)
	if err != nil {
		return VerifiedRawImage{}, err
	}
	if err := file.Close(); err != nil {
		return VerifiedRawImage{}, fmt.Errorf("close verified raw image: %w", err)
	}
	return verified, nil
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

// validateRawDiskApplyRequestPolicy checks every non-I/O invariant needed before
// the prepared image is opened through the write-locked handle. Keeping the
// cryptographic file verification out of this helper avoids hashing a large
// target-sized sparse image repeatedly; applyRawDiskInternal performs that hash
// once on the exact handle that is subsequently used for the raw write.
func validateRawDiskApplyRequestPolicy(request RawDiskApplyRequest) (Target, error) {
	confirmed, err := MatchConfirmedTarget([]Target{request.Target}, request.ConfirmationToken)
	if err != nil {
		return Target{}, err
	}
	if confirmed.SystemDisk || confirmed.BusType != "usb" || !confirmed.PrototypeSafe || confirmed.PhysicalDiskBytes == 0 {
		return Target{}, errors.New("target is not eligible for physical write")
	}
	if !request.CanonicalTrustResolved {
		return Target{}, errors.New("physical write blocked: canonical release trust is unresolved")
	}
	if strings.TrimSpace(request.Image.Path) == "" {
		return Target{}, errors.New("raw image path is required")
	}
	if !validLowerSHA256(request.Image.SHA256) {
		return Target{}, errors.New("expected raw image SHA-256 must be lowercase 64-hex")
	}
	if request.Image.SizeBytes <= 0 {
		return Target{}, errors.New("expected raw image size must be positive")
	}
	if uint64(request.Image.SizeBytes) != confirmed.PhysicalDiskBytes {
		return Target{}, fmt.Errorf(
			"physical write blocked: full-disk image size must equal physical device size: image=%d device=%d",
			request.Image.SizeBytes,
			confirmed.PhysicalDiskBytes,
		)
	}
	if request.BootstrapSeedBytes < 0 || request.BootstrapSeedBytes > request.Image.SizeBytes {
		return Target{}, errors.New("physical write blocked: bootstrap seed size is outside the prepared image")
	}

	expectedAuthorization := DestructiveAuthorizationToken(confirmed, request.Image)
	if request.DestructiveAuthorization != expectedAuthorization {
		return Target{}, errors.New("physical write blocked: destructive authorization does not match current target and image")
	}
	return confirmed, nil
}

func ValidateRawDiskApplyRequest(request RawDiskApplyRequest) error {
	if _, err := validateRawDiskApplyRequestPolicy(request); err != nil {
		return err
	}
	verified, err := VerifyRawImage(request.Image.Path, request.Image.SHA256, request.Image.SizeBytes)
	if err != nil {
		return err
	}
	if verified.SizeBytes <= 0 {
		return errors.New("verified raw image is empty")
	}
	return nil
}

func streamRawImageVerified(source io.Reader, destination io.Writer, expectedSHA256 string, expectedSizeBytes int64) (int64, error) {
	if !validLowerSHA256(expectedSHA256) || expectedSizeBytes <= 0 {
		return 0, errors.New("invalid expected raw image identity")
	}

	digest := sha256.New()
	limited := io.LimitReader(source, expectedSizeBytes)
	written, err := io.Copy(io.MultiWriter(destination, digest), limited)
	if err != nil {
		return written, fmt.Errorf("stream raw image: %w", err)
	}
	if written != expectedSizeBytes {
		return written, fmt.Errorf("raw image changed while streaming: expected=%d actual=%d", expectedSizeBytes, written)
	}

	var extra [1]byte
	extraCount, extraErr := source.Read(extra[:])
	if extraCount != 0 {
		return written, errors.New("raw image changed while streaming: source grew beyond authorized size")
	}
	if extraErr != nil && !errors.Is(extraErr, io.EOF) {
		return written, fmt.Errorf("check raw image end: %w", extraErr)
	}

	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA256 {
		return written, fmt.Errorf("raw image changed while streaming: expected SHA-256=%s actual=%s", expectedSHA256, actual)
	}
	return written, nil
}
