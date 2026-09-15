package physicalchannel

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const currentEnvelopeName = "current-envelope.json"

func physicalRoot(root string) (string, error) {
	if strings.TrimSpace(root) != "" {
		return filepath.Clean(root), nil
	}
	if runtime.GOOS == "windows" {
		if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
			return filepath.Join(profile, "OrdaX-Creator", "physical"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ordax-creator-physical"), nil
}

func writeEnvelopeAtomic(path string, data []byte) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(parent, ".ordax-physical-envelope-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	remove := true
	defer func() {
		_ = temp.Close()
		if remove {
			_ = os.Remove(tempPath)
		}
	}()
	if _, err := temp.Write(data); err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(tempPath, 0o600); err != nil {
			return err
		}
	}
	_ = os.Remove(path)
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	remove = false
	return nil
}

// Current is deliberately strict: offline use is allowed only when the cached
// pointer is itself the exact signed envelope and the referenced candidate
// still passes every file hash/size binding. No unsigned local metadata can
// promote a physical writer.
func Current(root string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	root, err := physicalRoot(root)
	if err != nil {
		return Installed{}, err
	}
	envelopePath := filepath.Join(root, currentEnvelopeName)
	info, err := os.Lstat(envelopePath)
	if err != nil {
		return Installed{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("cached physical envelope is not a regular non-symlink file")
	}
	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		return Installed{}, err
	}
	manifest, err := VerifyEnvelope(envelopeBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, err
	}
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	dirInfo, err := os.Lstat(directory)
	if err != nil || !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("cached physical candidate directory is unavailable or unsafe")
	}
	if err := VerifyInstalled(directory, manifest); err != nil {
		return Installed{}, err
	}
	return Installed{SourceCommit: manifest.SourceCommit, Directory: directory, Manifest: manifest}, nil
}

// AcquireCached first lets the canonical online acquisition path install and
// verify a candidate. It then performs a second independent read of the signed
// envelope. The cache pointer is committed only if that second envelope still
// names the same commit and all installed bytes still match its bindings.
// This prevents a moving release pointer from creating an unsafe offline cache.
func AcquireCached(client *http.Client, root, envelopeURL string, trustBytes []byte, expectedTrustSHA256 string) (Installed, bool, error) {
	installed, changed, err := Acquire(client, root, envelopeURL, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, err
	}
	actualRoot, err := physicalRoot(root)
	if err != nil {
		return Installed{}, false, err
	}
	if envelopeURL == "" {
		envelopeURL = DefaultEnvelopeURL
	}
	separator := "?"
	if strings.Contains(envelopeURL, "?") {
		separator = "&"
	}
	verifyURL := envelopeURL + separator + "ordax_cache_verify=" + fmt.Sprint(time.Now().UnixNano())
	envelopeBytes, err := fetchBytes(client, verifyURL, maxEnvelopeBytes)
	if err != nil {
		return installed, changed, nil
	}
	manifest, err := VerifyEnvelope(envelopeBytes, trustBytes, expectedTrustSHA256)
	if err != nil || manifest.SourceCommit != installed.SourceCommit {
		return installed, changed, nil
	}
	if err := VerifyInstalled(installed.Directory, manifest); err != nil {
		return Installed{}, false, err
	}
	if err := writeEnvelopeAtomic(filepath.Join(actualRoot, currentEnvelopeName), envelopeBytes); err != nil {
		return installed, changed, nil
	}
	return installed, changed, nil
}
