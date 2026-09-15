package update

import (
	"archive/zip"
	"crypto/sha256"
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
	ChannelSchema       = "prototype-ordax.creator-update-channel/2"
	DevelopmentChannel  = "development"
	DefaultManifestURL  = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/creator-dev-manifest.json"
	maxManifestBytes    = 256 << 10
	maxPayloadBytes     = int64(128 << 20)
	maxExtractedBytes   = int64(256 << 20)
	maxArchiveFileCount = 128
)

var (
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

type Payload struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type Entrypoints struct {
	Inspect string `json:"inspect"`
	Status  string `json:"status"`
}

type Manifest struct {
	Schema       string      `json:"$schema"`
	Channel      string      `json:"channel"`
	Version      string      `json:"version"`
	SourceCommit string      `json:"source_commit"`
	Payload      Payload     `json:"payload"`
	Entrypoints  Entrypoints `json:"entrypoints"`
}

type Installed struct {
	Schema       string `json:"$schema"`
	Channel      string `json:"channel"`
	Version      string `json:"version"`
	SourceCommit string `json:"source_commit"`
	Directory    string `json:"directory"`
}

func installRoot() (string, error) {
	if runtime.GOOS == "windows" {
		if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
			return filepath.Join(profile, "OrdaX-Creator"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ordax-creator"), nil
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

func validateAssetURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("payload URL must be canonical HTTPS github.com URL")
	}
	prefix := "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return errors.New("payload URL must stay inside the OrdaX creator-dev release")
	}
	return nil
}

func ValidateManifest(m Manifest) error {
	if m.Schema != ChannelSchema {
		return fmt.Errorf("unsupported update schema %q", m.Schema)
	}
	if m.Channel != DevelopmentChannel {
		return fmt.Errorf("development bootstrap refuses channel %q", m.Channel)
	}
	if !versionPattern.MatchString(m.Version) {
		return errors.New("invalid update version")
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if !shaPattern.MatchString(m.Payload.SHA256) {
		return errors.New("payload SHA-256 must be lowercase 64-hex")
	}
	if m.Payload.Size <= 0 || m.Payload.Size > maxPayloadBytes {
		return errors.New("payload size outside allowed range")
	}
	if err := validateAssetURL(m.Payload.URL); err != nil {
		return err
	}
	for label, value := range map[string]string{
		"inspect": m.Entrypoints.Inspect,
		"status":  m.Entrypoints.Status,
	} {
		if !safeRelative(value) {
			return fmt.Errorf("unsafe %s entrypoint", label)
		}
	}
	return nil
}

func decodeManifest(data []byte) (Manifest, error) {
	if len(data) == 0 || len(data) > maxManifestBytes {
		return Manifest{}, errors.New("update manifest size outside allowed range")
	}
	var m Manifest
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return Manifest{}, errors.New("multiple JSON values are forbidden")
		}
		return Manifest{}, err
	}
	if err := ValidateManifest(m); err != nil {
		return Manifest{}, err
	}
	return m, nil
}

func fetchBytes(client *http.Client, raw string, limit int64) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Updater/2")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from update source", resp.StatusCode)
	}
	reader := io.LimitReader(resp.Body, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("download exceeded allowed size")
	}
	return data, nil
}

func FetchManifest(client *http.Client, manifestURL string) (Manifest, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if manifestURL == "" {
		manifestURL = DefaultManifestURL
	}
	separator := "?"
	if strings.Contains(manifestURL, "?") {
		separator = "&"
	}
	data, err := fetchBytes(client, manifestURL+separator+"ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), maxManifestBytes)
	if err != nil {
		return Manifest{}, err
	}
	return decodeManifest(data)
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(parent, ".ordax-write-*")
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
	if err := os.Chmod(tempPath, mode); err != nil && runtime.GOOS != "windows" {
		return err
	}
	_ = os.Remove(path)
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	remove = false
	return nil
}

func downloadPayload(client *http.Client, payload Payload, out string) error {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	req, err := http.NewRequest(http.MethodGet, payload.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Updater/2")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading Creator payload", resp.StatusCode)
	}
	file, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(out)
		}
	}()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, h), io.LimitReader(resp.Body, payload.Size+1))
	if err != nil {
		return err
	}
	if n != payload.Size {
		return fmt.Errorf("payload size mismatch: expected=%d actual=%d", payload.Size, n)
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != payload.SHA256 {
		return fmt.Errorf("payload SHA-256 mismatch: expected=%s actual=%s", payload.SHA256, actual)
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

func verifyEntrypoints(directory string, manifest Manifest) error {
	for label, entry := range map[string]string{
		"inspect": manifest.Entrypoints.Inspect,
		"status":  manifest.Entrypoints.Status,
	} {
		info, err := os.Lstat(filepath.Join(directory, filepath.FromSlash(entry)))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("required %s entrypoint missing or unsafe", label)
		}
	}
	return nil
}

func extractPayload(zipPath, destination string, manifest Manifest) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > maxArchiveFileCount {
		return errors.New("archive file count outside allowed range")
	}
	seen := make(map[string]struct{}, len(archive.File))
	var total int64
	for _, item := range archive.File {
		if !safeRelative(item.Name) {
			return fmt.Errorf("unsafe archive path %q", item.Name)
		}
		cleanName := filepath.Clean(filepath.FromSlash(item.Name))
		if _, exists := seen[cleanName]; exists {
			return fmt.Errorf("duplicate archive path %q", item.Name)
		}
		seen[cleanName] = struct{}{}
		if item.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink is forbidden in update archive: %q", item.Name)
		}
		total += int64(item.UncompressedSize64)
		if total > maxExtractedBytes {
			return errors.New("archive expands beyond allowed size")
		}
		target := filepath.Join(destination, cleanName)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		r, err := item.Open()
		if err != nil {
			return err
		}
		w, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
		if err != nil {
			_ = r.Close()
			return err
		}
		_, copyErr := io.Copy(w, r)
		closeWriteErr := w.Close()
		closeReadErr := r.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeWriteErr != nil {
			return closeWriteErr
		}
		if closeReadErr != nil {
			return closeReadErr
		}
	}
	return verifyEntrypoints(destination, manifest)
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func Current(root string) (Installed, error) {
	if root == "" {
		var err error
		root, err = installRoot()
		if err != nil {
			return Installed{}, err
		}
	}
	data, err := os.ReadFile(filepath.Join(root, "current.json"))
	if err != nil {
		return Installed{}, err
	}
	var current Installed
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&current); err != nil {
		return Installed{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Installed{}, errors.New("invalid installed Creator metadata")
	}
	if current.Schema != "prototype-ordax.creator-installed/1" ||
		current.Channel != DevelopmentChannel ||
		!versionPattern.MatchString(current.Version) ||
		!commitPattern.MatchString(current.SourceCommit) {
		return Installed{}, errors.New("invalid installed Creator metadata")
	}
	expected := filepath.Join(root, "versions", current.SourceCommit)
	if !samePath(current.Directory, expected) {
		return Installed{}, errors.New("installed Creator directory is outside its version slot")
	}
	info, err := os.Lstat(current.Directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Installed{}, errors.New("installed Creator directory is unavailable or unsafe")
	}
	return current, nil
}

func Ensure(client *http.Client, root, manifestURL string) (Installed, bool, error) {
	if root == "" {
		var err error
		root, err = installRoot()
		if err != nil {
			return Installed{}, false, err
		}
	}
	manifest, err := FetchManifest(client, manifestURL)
	if err != nil {
		return Installed{}, false, err
	}
	if current, err := Current(root); err == nil && current.SourceCommit == manifest.SourceCommit {
		if err := verifyEntrypoints(current.Directory, manifest); err != nil {
			return Installed{}, false, fmt.Errorf("installed Creator payload failed validation: %w", err)
		}
		return current, false, nil
	}
	versionsDir := filepath.Join(root, "versions")
	if err := os.MkdirAll(versionsDir, 0o755); err != nil {
		return Installed{}, false, err
	}
	finalDir := filepath.Join(versionsDir, manifest.SourceCommit)
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Installed{}, false, errors.New("existing Creator version slot is unsafe")
		}
		if err := verifyEntrypoints(finalDir, manifest); err != nil {
			return Installed{}, false, fmt.Errorf("existing Creator version slot failed validation: %w", err)
		}
		installed := Installed{Schema: "prototype-ordax.creator-installed/1", Channel: manifest.Channel, Version: manifest.Version, SourceCommit: manifest.SourceCommit, Directory: finalDir}
		data, _ := json.MarshalIndent(installed, "", "  ")
		data = append(data, '\n')
		if err := writeAtomic(filepath.Join(root, "current.json"), data, 0o644); err != nil {
			return Installed{}, false, err
		}
		return installed, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Installed{}, false, err
	}

	tempDir, err := os.MkdirTemp(versionsDir, ".install-*")
	if err != nil {
		return Installed{}, false, err
	}
	defer os.RemoveAll(tempDir)
	zipPath := filepath.Join(tempDir, "payload.zip")
	if err := downloadPayload(client, manifest.Payload, zipPath); err != nil {
		return Installed{}, false, err
	}
	extracted := filepath.Join(tempDir, "payload")
	if err := os.Mkdir(extracted, 0o755); err != nil {
		return Installed{}, false, err
	}
	if err := extractPayload(zipPath, extracted, manifest); err != nil {
		return Installed{}, false, err
	}
	if err := os.Rename(extracted, finalDir); err != nil {
		return Installed{}, false, err
	}
	installed := Installed{Schema: "prototype-ordax.creator-installed/1", Channel: manifest.Channel, Version: manifest.Version, SourceCommit: manifest.SourceCommit, Directory: finalDir}
	data, _ := json.MarshalIndent(installed, "", "  ")
	data = append(data, '\n')
	if err := writeAtomic(filepath.Join(root, "current.json"), data, 0o644); err != nil {
		return Installed{}, false, err
	}
	return installed, true, nil
}
