package physicalchannel

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
	"sort"
	"strings"
	"time"
)

const (
	EnvelopeSchema      = "prototype-ordax.creator-physical-envelope/1"
	ManifestSchema      = "prototype-ordax.creator-physical-manifest/1"
	TrustSchema         = "prototype-ordax.release-trust/1"
	Purpose             = "creator-physical-windows-amd64"
	SourceRepository    = "washingtonmsdj/prototipo-ordax-os"
	Recipe              = "creator/physical/windows/1"
	DefaultEnvelopeURL  = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/creator-physical-envelope.json"
	bundleReleasePrefix = "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/"

	maxTrustBytes       = 16 << 10
	maxEnvelopeBytes    = 1 << 20
	maxManifestBytes    = 512 << 10
	maxBundleBytes      = int64(2 << 30)
	maxExtractedBytes   = int64(2 << 30)
	maxArchiveFileCount = 32
)

var (
	keyIDPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
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
	Schema            string        `json:"$schema"`
	Purpose           string        `json:"purpose"`
	SourceRepository  string        `json:"source_repository"`
	SourceCommit      string        `json:"source_commit"`
	CreatedFromRecipe string        `json:"created_from_recipe"`
	Bundle            Bundle        `json:"bundle"`
	Files             []FileBinding `json:"files"`
}

type Installed struct {
	SourceCommit string
	Directory    string
	Manifest     Manifest
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

func validHTTPSAssetURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("physical bundle URL must be canonical HTTPS github.com URL")
	}
	if !strings.HasPrefix(parsed.Path, bundleReleasePrefix) {
		return errors.New("physical bundle URL must stay inside the creator-physical release")
	}
	return nil
}

func expectedFiles() map[string]struct{} {
	return map[string]struct{}{
		"ordax-creator-physical-test.exe": {},
		"ordax-bootstrap-seed.raw":         {},
		"release-ed25519.json":             {},
		"provenance.json":                  {},
		"SHA256SUMS":                       {},
	}
}

func validateManifest(m Manifest) error {
	if m.Schema != ManifestSchema {
		return errors.New("unsupported physical manifest schema")
	}
	if m.Purpose != Purpose {
		return fmt.Errorf("unexpected physical manifest purpose %q", m.Purpose)
	}
	if m.SourceRepository != SourceRepository {
		return fmt.Errorf("unexpected source repository %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if m.CreatedFromRecipe != Recipe {
		return fmt.Errorf("unexpected physical recipe %q", m.CreatedFromRecipe)
	}
	if !shaPattern.MatchString(m.Bundle.SHA256) {
		return errors.New("physical bundle SHA-256 must be lowercase 64-hex")
	}
	if m.Bundle.Size <= 0 || m.Bundle.Size > maxBundleBytes {
		return errors.New("physical bundle size outside allowed range")
	}
	if err := validHTTPSAssetURL(m.Bundle.URL); err != nil {
		return err
	}

	expected := expectedFiles()
	if len(m.Files) != len(expected) {
		return fmt.Errorf("physical manifest requires exactly %d bound files", len(expected))
	}
	seen := make(map[string]struct{}, len(m.Files))
	for _, file := range m.Files {
		if _, ok := expected[file.Name]; !ok {
			return fmt.Errorf("unexpected physical file binding %q", file.Name)
		}
		if _, duplicate := seen[file.Name]; duplicate {
			return fmt.Errorf("duplicate physical file binding %q", file.Name)
		}
		seen[file.Name] = struct{}{}
		if !shaPattern.MatchString(file.SHA256) {
			return fmt.Errorf("invalid SHA-256 for %s", file.Name)
		}
		if file.Size <= 0 || file.Size > maxExtractedBytes {
			return fmt.Errorf("invalid size for %s", file.Name)
		}
	}
	return nil
}

func parseTrust(data []byte, expectedSHA256 string) (TrustAnchor, ed25519.PublicKey, error) {
	if expectedSHA256 == "" || !shaPattern.MatchString(expectedSHA256) {
		return TrustAnchor{}, nil, errors.New("expected canonical trust SHA-256 is unresolved or invalid")
	}
	actual := sha256.Sum256(data)
	if hex.EncodeToString(actual[:]) != expectedSHA256 {
		return TrustAnchor{}, nil, errors.New("canonical trust bytes do not match the Creator-pinned SHA-256")
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
		return Manifest{}, fmt.Errorf("decode physical envelope: %w", err)
	}
	if envelope.Schema != EnvelopeSchema {
		return Manifest{}, errors.New("unsupported physical envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return Manifest{}, errors.New("physical envelope key_id does not match canonical trust")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxManifestBytes {
		return Manifest{}, errors.New("physical manifest payload size outside allowed range")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(public, envelope.Payload, envelope.Signature) {
		return Manifest{}, errors.New("physical manifest signature verification failed")
	}
	var manifest Manifest
	if err := decodeStrict(envelope.Payload, maxManifestBytes, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode signed physical manifest: %w", err)
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func safeRelative(name string) bool {
	if name == "" || filepath.IsAbs(name) || strings.ContainsRune(name, '\x00') {
		return false
	}
	clean := filepath.Clean(filepath.FromSlash(name))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return false
	}
	return clean == filepath.FromSlash(name)
}

func fileDigest(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("bound file is not a regular non-symlink file")
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
	for _, binding := range manifest.Files {
		path := filepath.Join(directory, binding.Name)
		actualHash, actualSize, err := fileDigest(path)
		if err != nil {
			return fmt.Errorf("verify %s: %w", binding.Name, err)
		}
		if actualSize != binding.Size || actualHash != binding.SHA256 {
			return fmt.Errorf("bound physical file changed: %s", binding.Name)
		}
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
	req.Header.Set("User-Agent", "OrdaX-Creator-Physical/1")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from physical release source", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("physical release document exceeded allowed size")
	}
	return data, nil
}

func downloadBundle(client *http.Client, bundle Bundle, destination string) error {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	req, err := http.NewRequest(http.MethodGet, bundle.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Physical/1")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading physical candidate", resp.StatusCode)
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
		return fmt.Errorf("physical bundle size mismatch: expected=%d actual=%d", bundle.Size, n)
	}
	if hex.EncodeToString(h.Sum(nil)) != bundle.SHA256 {
		return errors.New("physical bundle SHA-256 mismatch")
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
	if len(archive.File) == 0 || len(archive.File) > maxArchiveFileCount {
		return errors.New("physical archive file count outside allowed range")
	}
	expected := expectedFiles()
	seen := make(map[string]struct{}, len(archive.File))
	var total int64
	for _, item := range archive.File {
		if !safeRelative(item.Name) {
			return fmt.Errorf("unsafe physical archive path %q", item.Name)
		}
		clean := filepath.Clean(filepath.FromSlash(item.Name))
		if strings.Contains(clean, string(filepath.Separator)) {
			return fmt.Errorf("physical archive must be flat: %q", item.Name)
		}
		if _, ok := expected[clean]; !ok {
			return fmt.Errorf("unexpected file in physical bundle: %q", item.Name)
		}
		if _, duplicate := seen[clean]; duplicate {
			return fmt.Errorf("duplicate file in physical bundle: %q", item.Name)
		}
		seen[clean] = struct{}{}
		if item.FileInfo().IsDir() || item.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid file type in physical bundle: %q", item.Name)
		}
		total += int64(item.UncompressedSize64)
		if total > maxExtractedBytes {
			return errors.New("physical archive expands beyond allowed size")
		}
		reader, err := item.Open()
		if err != nil {
			return err
		}
		target := filepath.Join(destination, clean)
		writer, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700)
		if err != nil {
			_ = reader.Close()
			return err
		}
		_, copyErr := io.Copy(writer, reader)
		writeCloseErr := writer.Close()
		readCloseErr := reader.Close()
		if copyErr != nil {
			return copyErr
		}
		if writeCloseErr != nil {
			return writeCloseErr
		}
		if readCloseErr != nil {
			return readCloseErr
		}
	}
	if len(seen) != len(expected) {
		missing := make([]string, 0)
		for name := range expected {
			if _, ok := seen[name]; !ok {
				missing = append(missing, name)
			}
		}
		sort.Strings(missing)
		return fmt.Errorf("physical bundle is missing required files: %s", strings.Join(missing, ", "))
	}
	return VerifyInstalled(destination, manifest)
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func Acquire(client *http.Client, root, envelopeURL string, trustBytes []byte, expectedTrustSHA256 string) (Installed, bool, error) {
	if envelopeURL == "" {
		envelopeURL = DefaultEnvelopeURL
	}
	separator := "?"
	if strings.Contains(envelopeURL, "?") {
		separator = "&"
	}
	envelopeBytes, err := fetchBytes(client, envelopeURL+separator+"ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), maxEnvelopeBytes)
	if err != nil {
		return Installed{}, false, err
	}
	manifest, err := VerifyEnvelope(envelopeBytes, trustBytes, expectedTrustSHA256)
	if err != nil {
		return Installed{}, false, err
	}
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Installed{}, false, err
		}
		root = filepath.Join(home, ".ordax-creator-physical")
		if runtime.GOOS == "windows" {
			if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
				root = filepath.Join(profile, "OrdaX-Creator", "physical")
			}
		}
	}
	versions := filepath.Join(root, "versions")
	if err := os.MkdirAll(versions, 0o755); err != nil {
		return Installed{}, false, err
	}
	finalDir := filepath.Join(versions, manifest.SourceCommit)
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Installed{}, false, errors.New("existing physical candidate slot is unsafe")
		}
		if err := VerifyInstalled(finalDir, manifest); err != nil {
			return Installed{}, false, err
		}
		return Installed{SourceCommit: manifest.SourceCommit, Directory: finalDir, Manifest: manifest}, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Installed{}, false, err
	}

	tempDir, err := os.MkdirTemp(versions, ".physical-install-*")
	if err != nil {
		return Installed{}, false, err
	}
	defer os.RemoveAll(tempDir)
	bundlePath := filepath.Join(tempDir, "candidate.zip")
	if err := downloadBundle(client, manifest.Bundle, bundlePath); err != nil {
		return Installed{}, false, err
	}
	extracted := filepath.Join(tempDir, "candidate")
	if err := os.Mkdir(extracted, 0o755); err != nil {
		return Installed{}, false, err
	}
	if err := extractBundle(bundlePath, extracted, manifest); err != nil {
		return Installed{}, false, err
	}
	if err := os.Rename(extracted, finalDir); err != nil {
		return Installed{}, false, err
	}
	if !samePath(finalDir, filepath.Join(versions, manifest.SourceCommit)) {
		return Installed{}, false, errors.New("physical candidate escaped its version slot")
	}
	return Installed{SourceCommit: manifest.SourceCommit, Directory: finalDir, Manifest: manifest}, true, nil
}
