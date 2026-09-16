package appchannel

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	pendingEnvelopeName  = "pending-envelope.json"
	previousEnvelopeName = "previous-envelope.json"
)

func readInstalledEnvelope(root, name string, trustBytes []byte, expectedTrustSHA256 string) (Installed, []byte, error) {
	path := filepath.Join(root, name)
	info, err := os.Lstat(path)
	if err != nil {
		return Installed{}, nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return Installed{}, nil, fmt.Errorf("cached Creator app envelope %s is unsafe", name)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Installed{}, nil, err
	}
	manifest, err := VerifyEnvelope(data, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, nil, err
	}
	installed, err := installedFrom(root, manifest)
	if err != nil {
		return Installed{}, nil, err
	}
	return installed, data, nil
}

// Previous returns the last signed Creator app that was current immediately
// before the latest promoted update. It is never populated from an unverified
// candidate.
func Previous(root string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	actualRoot, err := appRoot(root)
	if err != nil {
		return Installed{}, err
	}
	installed, _, err := readInstalledEnvelope(actualRoot, previousEnvelopeName, trustBytes, expectedTrustSHA256)
	return installed, err
}

// LastKnownGood prefers the current signed app and falls back to the previous
// signed app when the current slot or envelope is unavailable/corrupted.
func LastKnownGood(root string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	current, currentErr := Current(root, trustBytes, expectedTrustSHA256)
	if currentErr == nil {
		return current, nil
	}
	previous, previousErr := Previous(root, trustBytes, expectedTrustSHA256)
	if previousErr == nil {
		return previous, nil
	}
	return Installed{}, fmt.Errorf("current Creator app invalid (%v) and previous signed app unavailable (%v)", currentErr, previousErr)
}

func installCandidate(client *http.Client, root string, manifest Manifest) (Installed, bool, error) {
	versions := filepath.Join(root, "versions")
	if err := os.MkdirAll(versions, 0o755); err != nil {
		return Installed{}, false, err
	}
	finalDir := filepath.Join(versions, manifest.SourceCommit)
	if installed, err := installedFrom(root, manifest); err == nil {
		return installed, false, nil
	}
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Installed{}, false, errors.New("existing Creator app version slot is unsafe")
		}
		return Installed{}, false, errors.New("existing Creator app version slot does not match signed manifest")
	} else if !errors.Is(err, os.ErrNotExist) {
		return Installed{}, false, err
	}

	tempDir, err := os.MkdirTemp(versions, ".app-pending-*")
	if err != nil {
		return Installed{}, false, err
	}
	defer os.RemoveAll(tempDir)
	artifactPath := filepath.Join(tempDir, ArtifactName)
	if err := downloadArtifact(client, manifest.Artifact, artifactPath); err != nil {
		return Installed{}, false, err
	}
	if err := os.Rename(tempDir, finalDir); err != nil {
		return Installed{}, false, err
	}
	installed, err := installedFrom(root, manifest)
	if err != nil {
		return Installed{}, false, err
	}
	return installed, true, nil
}

// AcquirePending verifies and stages a signed Creator app update without
// changing current-envelope.json. A candidate becomes current only after the
// launcher proves that the executable itself can start and calls PromotePending.
func AcquirePending(client *http.Client, root, envelopeURL string, trustBytes []byte, expectedTrustSHA256 string) (Installed, bool, error) {
	actualRoot, err := appRoot(root)
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
	firstBytes, err := fetchBytes(client, envelopeURL+separator+"ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), maxEnvelopeBytes)
	if err != nil {
		return Installed{}, false, err
	}
	manifest, err := VerifyEnvelope(firstBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, err
	}
	if err := checkRollback(actualRoot, manifest, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, false, err
	}
	if current, err := Current(actualRoot, trustBytes, expectedTrustSHA256); err == nil && current.SourceCommit == manifest.SourceCommit {
		_ = os.Remove(filepath.Join(actualRoot, pendingEnvelopeName))
		return current, false, nil
	}

	installed, _, err := installCandidate(client, actualRoot, manifest)
	if err != nil {
		return Installed{}, false, err
	}

	verifyBytes, err := fetchBytes(client, envelopeURL+separator+"ordax_pending_verify="+fmt.Sprint(time.Now().UnixNano()), maxEnvelopeBytes)
	if err != nil {
		return Installed{}, false, fmt.Errorf("re-fetch signed Creator app envelope before activation: %w", err)
	}
	if !bytes.Equal(firstBytes, verifyBytes) {
		return Installed{}, false, errors.New("Creator app envelope changed while preparing update")
	}
	verifyManifest, err := VerifyEnvelope(verifyBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, err
	}
	if verifyManifest.SourceCommit != manifest.SourceCommit || verifyManifest.ReleaseSequence != manifest.ReleaseSequence {
		return Installed{}, false, errors.New("Creator app envelope identity changed while preparing update")
	}
	if err := checkRollback(actualRoot, verifyManifest, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, false, err
	}
	if _, err := installedFrom(actualRoot, verifyManifest); err != nil {
		return Installed{}, false, err
	}
	if err := writeEnvelopeAtomic(filepath.Join(actualRoot, pendingEnvelopeName), verifyBytes); err != nil {
		return Installed{}, false, err
	}
	return installed, true, nil
}

// PromotePending atomically preserves the previous verified envelope before
// replacing current with the health-checked pending candidate.
func PromotePending(root, expectedSourceCommit string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	actualRoot, err := appRoot(root)
	if err != nil {
		return Installed{}, err
	}
	pending, pendingBytes, err := readInstalledEnvelope(actualRoot, pendingEnvelopeName, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, err
	}
	if pending.SourceCommit != expectedSourceCommit {
		return Installed{}, errors.New("pending Creator app does not match the health-checked source commit")
	}
	if err := checkRollback(actualRoot, pending.Manifest, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, err
	}

	current, currentBytes, currentErr := readInstalledEnvelope(actualRoot, currentEnvelopeName, trustBytes, expectedTrustSHA256)
	if currentErr == nil {
		if current.SourceCommit == pending.SourceCommit {
			_ = os.Remove(filepath.Join(actualRoot, pendingEnvelopeName))
			return current, nil
		}
		if err := writeEnvelopeAtomic(filepath.Join(actualRoot, previousEnvelopeName), currentBytes); err != nil {
			return Installed{}, fmt.Errorf("preserve previous signed Creator app: %w", err)
		}
	} else if !errors.Is(currentErr, os.ErrNotExist) {
		return Installed{}, fmt.Errorf("current Creator app is invalid; refusing pending promotion: %w", currentErr)
	}

	if err := writeEnvelopeAtomic(filepath.Join(actualRoot, currentEnvelopeName), pendingBytes); err != nil {
		return Installed{}, err
	}
	if err := os.Remove(filepath.Join(actualRoot, pendingEnvelopeName)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Installed{}, err
	}
	return pending, nil
}

// DiscardPending removes only the activation marker. Verified version bytes may
// remain in their immutable source-commit slot and can be reused by a later
// signed retry without becoming executable through the launcher by themselves.
func DiscardPending(root string) error {
	actualRoot, err := appRoot(root)
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(actualRoot, pendingEnvelopeName)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
