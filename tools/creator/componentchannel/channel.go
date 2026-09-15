package componentchannel

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	EnvelopeSchema     = "prototype-ordax.creator-component-envelope/1"
	ManifestSchema     = "prototype-ordax.creator-component-manifest/1"
	TrustSchema        = "prototype-ordax.release-trust/1"
	Purpose            = "creator-inspection-windows-amd64"
	SourceRepository   = "washingtonmsdj/prototipo-ordax-os"
	Recipe             = "creator/component/windows/1"
	DefaultEnvelopeURL = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/creator-component-envelope.json"

	bundleName          = "ordax-creator-components-windows-amd64.zip"
	expectedFile        = "ordax-creator-physical-test.exe"
	releasePathPrefix   = "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/"
	currentEnvelopeName = "current-envelope.json"
	maxTrustBytes       = 16 << 10
	maxEnvelopeBytes    = 1 << 20
	maxManifestBytes    = 256 << 10
	maxBundleBytes      = int64(64 << 20)
	maxComponentBytes   = int64(32 << 20)
)

var (
	keyIDPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

type TrustAnchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type Envelope struct {
	Schema    string `json:"$schema"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
	KeyID     string `json:"key_id"`
}

type FileBinding struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type Bundle struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type Manifest struct {
	Schema            string      `json:"$schema"`
	Purpose           string      `json:"purpose"`
	SourceRepository  string      `json:"source_repository"`
	SourceCommit      string      `json:"source_commit"`
	Version           string      `json:"version"`
	ReleaseSequence   int64       `json:"release_sequence"`
	CreatedFromRecipe string      `json:"created_from_recipe"`
	Bundle            Bundle      `json:"bundle"`
	File              FileBinding `json:"file"`
}

type Installed struct {
	Version         string
	SourceCommit    string
	ReleaseSequence int64
	Directory       string
	Manifest        Manifest
}

func decodeStrict(data []byte, max int, target any) error {
	if len(data) == 0 || len(data) > max {
		return fmt.Errorf("document size outside allowed range: %d", len(data))
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}

func validateBundleURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" {
		return errors.New("component bundle URL must be canonical HTTPS github.com URL")
	}
	if parsed.Path != releasePathPrefix+bundleName {
		return errors.New("component bundle URL must reference the canonical creator-components asset")
	}
	return nil
}

func validateManifest(m Manifest) error {
	if m.Schema != ManifestSchema {
		return errors.New("unsupported Creator component manifest schema")
	}
	if m.Purpose != Purpose || m.SourceRepository != SourceRepository || m.CreatedFromRecipe != Recipe {
		return errors.New("Creator component manifest identity/purpose is not canonical")
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if !versionPattern.MatchString(m.Version) {
		return errors.New("invalid Creator component version")
	}
	if m.ReleaseSequence <= 0 {
		return errors.New("Creator component release_sequence must be positive")
	}
	if !shaPattern.MatchString(m.Bundle.SHA256) || m.Bundle.Size <= 0 || m.Bundle.Size > maxBundleBytes {
		return errors.New("Creator component bundle binding is invalid")
	}
	if err := validateBundleURL(m.Bundle.URL); err != nil {
		return err
	}
	if m.File.Name != expectedFile || !shaPattern.MatchString(m.File.SHA256) || m.File.Size <= 0 || m.File.Size > maxComponentBytes {
		return errors.New("Creator component file binding is invalid")
	}
	return nil
}

func parseTrust(data []byte, expectedSHA256 string) (TrustAnchor, ed25519.PublicKey, error) {
	if !shaPattern.MatchString(expectedSHA256) {
		return TrustAnchor{}, nil, errors.New("expected canonical trust SHA-256 is unresolved or invalid")
	}
	actual := sha256.Sum256(data)
	if hex.EncodeToString(actual[:]) != expectedSHA256 {
		return TrustAnchor{}, nil, errors.New("canonical trust bytes do not match Creator-pinned SHA-256")
	}
	var trust TrustAnchor
	if err := decodeStrict(data, maxTrustBytes, &trust); err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("decode canonical trust: %w", err)
	}
	if trust.Schema != TrustSchema || !keyIDPattern.MatchString(trust.KeyID) {
		return TrustAnchor{}, nil, errors.New("canonical trust anchor is invalid")
	}
	public, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return TrustAnchor{}, nil, errors.New("canonical trust anchor does not contain a valid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(public), nil
}

func VerifyEnvelope(envelopeBytes, trustBytes []byte, expectedTrustSHA256 string) (Manifest, error) {
	trust, public, err := parseTrust(trustBytes, expectedTrustSHA256)
	if err != nil {
		return Manifest{}, err
	}
	var envelope Envelope
	if err := decodeStrict(envelopeBytes, maxEnvelopeBytes, &envelope); err != nil {
		return Manifest{}, fmt.Errorf("decode Creator component envelope: %w", err)
	}
	if envelope.Schema != EnvelopeSchema {
		return Manifest{}, errors.New("unsupported Creator component envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return Manifest{}, errors.New("Creator component envelope key_id does not match canonical trust")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxManifestBytes {
		return Manifest{}, errors.New("Creator component manifest payload size outside allowed range")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(public, envelope.Payload, envelope.Signature) {
		return Manifest{}, errors.New("Creator component manifest signature verification failed")
	}
	var manifest Manifest
	if err := decodeStrict(envelope.Payload, maxManifestBytes, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode signed Creator component manifest: %w", err)
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func componentRoot(root string) (string, error) {
	if strings.TrimSpace(root) != "" {
		return filepath.Clean(root), nil
	}
	if runtime.GOOS == "windows" {
		if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
			return filepath.Join(profile, "OrdaX-Creator", "official-components"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ordax-creator-official-components"), nil
}

func fileDigest(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("Creator component is not a regular non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	n, err := io.Copy(h, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func VerifyInstalled(directory string, manifest Manifest) error {
	if err := validateManifest(manifest); err != nil {
		return err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Creator component directory is unavailable or unsafe")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	if len(entries) != 1 || entries[0].Name() != expectedFile {
		return errors.New("Creator component directory must contain exactly the bound inspection executable")
	}
	actualHash, actualSize, err := fileDigest(filepath.Join(directory, expectedFile))
	if err != nil {
		return err
	}
	if actualHash != manifest.File.SHA256 || actualSize != manifest.File.Size {
		return errors.New("Creator component bytes changed after verification")
	}
	return nil
}

func fetchBytes(client *http.Client, raw string, limit int64) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Components/1")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from Creator component source", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("Creator component document exceeded allowed size")
	}
	return data, nil
}

func downloadBundle(client *http.Client, bundle Bundle, destination string) error {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	req, err := http.NewRequest(http.MethodGet, bundle.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Components/1")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading Creator component bundle", resp.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(destination)
		}
	}()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, h), io.LimitReader(resp.Body, bundle.Size+1))
	if err != nil {
		return err
	}
	if n != bundle.Size {
		return fmt.Errorf("Creator component bundle size mismatch: expected=%d actual=%d", bundle.Size, n)
	}
	if hex.EncodeToString(h.Sum(nil)) != bundle.SHA256 {
		return errors.New("Creator component bundle SHA-256 mismatch")
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func extractBundle(zipPath, destination string, manifest Manifest) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	if len(archive.File) != 1 {
		return errors.New("Creator component archive must contain exactly one file")
	}
	item := archive.File[0]
	if item.Name != expectedFile || item.FileInfo().IsDir() || item.FileInfo().Mode()&os.ModeSymlink != 0 || item.UncompressedSize64 > uint64(maxComponentBytes) {
		return errors.New("Creator component archive contains an unexpected or unsafe entry")
	}
	reader, err := item.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	target := filepath.Join(destination, expectedFile)
	writer, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(writer, io.LimitReader(reader, maxComponentBytes+1))
	closeErr := writer.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return VerifyInstalled(destination, manifest)
}

func writeEnvelopeAtomic(path string, data []byte) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(parent, ".ordax-component-envelope-*")
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

func Current(root string, trustBytes []byte, expectedTrustSHA256 string) (Installed, error) {
	root, err := componentRoot(root)
	if err != nil {
		return Installed{}, err
	}
	envelopePath := filepath.Join(root, currentEnvelopeName)
	info, err := os.Lstat(envelopePath)
	if err != nil {
		return Installed{}, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("cached Creator component envelope is unsafe")
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
	if err := VerifyInstalled(directory, manifest); err != nil {
		return Installed{}, err
	}
	return Installed{Version: manifest.Version, SourceCommit: manifest.SourceCommit, ReleaseSequence: manifest.ReleaseSequence, Directory: directory, Manifest: manifest}, nil
}

func checkRollback(root string, candidate Manifest, trustBytes []byte, expectedTrustSHA256 string) error {
	current, err := Current(root, trustBytes, expectedTrustSHA256)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("existing Creator component baseline is invalid; refusing rollback-sensitive update: %w", err)
	}
	if candidate.ReleaseSequence < current.ReleaseSequence {
		return fmt.Errorf("Creator component rollback rejected: candidate sequence %d is older than current sequence %d", candidate.ReleaseSequence, current.ReleaseSequence)
	}
	if candidate.ReleaseSequence == current.ReleaseSequence && candidate.SourceCommit != current.SourceCommit {
		return fmt.Errorf("Creator component release sequence %d was reused by a different source commit", candidate.ReleaseSequence)
	}
	return nil
}

func AcquireCached(client *http.Client, root, envelopeURL string, trustBytes []byte, expectedTrustSHA256 string) (Installed, bool, error) {
	actualRoot, err := componentRoot(root)
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

	versions := filepath.Join(actualRoot, "versions")
	if err := os.MkdirAll(versions, 0o755); err != nil {
		return Installed{}, false, err
	}
	finalDir := filepath.Join(versions, manifest.SourceCommit)
	changed := false
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Installed{}, false, errors.New("existing Creator component version slot is unsafe")
		}
		if err := VerifyInstalled(finalDir, manifest); err != nil {
			return Installed{}, false, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Installed{}, false, err
	} else {
		tempDir, err := os.MkdirTemp(versions, ".component-install-*")
		if err != nil {
			return Installed{}, false, err
		}
		defer os.RemoveAll(tempDir)
		bundlePath := filepath.Join(tempDir, "candidate.zip")
		if err := downloadBundle(client, manifest.Bundle, bundlePath); err != nil {
			return Installed{}, false, err
		}
		extracted := filepath.Join(tempDir, "component")
		if err := os.Mkdir(extracted, 0o755); err != nil {
			return Installed{}, false, err
		}
		if err := extractBundle(bundlePath, extracted, manifest); err != nil {
			return Installed{}, false, err
		}
		if err := os.Rename(extracted, finalDir); err != nil {
			return Installed{}, false, err
		}
		changed = true
	}

	installed := Installed{Version: manifest.Version, SourceCommit: manifest.SourceCommit, ReleaseSequence: manifest.ReleaseSequence, Directory: finalDir, Manifest: manifest}
	verifyBytes, err := fetchBytes(client, envelopeURL+separator+"ordax_cache_verify="+fmt.Sprint(time.Now().UnixNano()), maxEnvelopeBytes)
	if err != nil {
		return installed, changed, nil
	}
	if !bytes.Equal(firstBytes, verifyBytes) {
		return installed, changed, nil
	}
	verifyManifest, err := VerifyEnvelope(verifyBytes, trustBytes, expectedTrustSHA256)
	if err != nil || verifyManifest.SourceCommit != manifest.SourceCommit || verifyManifest.ReleaseSequence != manifest.ReleaseSequence {
		return installed, changed, nil
	}
	if err := checkRollback(actualRoot, verifyManifest, trustBytes, expectedTrustSHA256); err != nil {
		return Installed{}, false, err
	}
	if err := VerifyInstalled(finalDir, verifyManifest); err != nil {
		return Installed{}, false, err
	}
	if err := writeEnvelopeAtomic(filepath.Join(actualRoot, currentEnvelopeName), verifyBytes); err != nil {
		return installed, changed, nil
	}
	installed.Manifest = verifyManifest
	return installed, changed, nil
}
