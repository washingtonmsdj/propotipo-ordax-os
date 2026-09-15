package update

import (
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
	"strings"
	"time"
)

const (
	ApplicationSchema      = "prototype-ordax.creator-app-update/1"
	DefaultApplicationURL  = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/creator-app.json"
	maxApplicationManifest = 64 << 10
	maxApplicationBytes    = int64(32 << 20)
)

type ApplicationManifest struct {
	Schema       string `json:"$schema"`
	Channel      string `json:"channel"`
	Version      string `json:"version"`
	SourceCommit string `json:"source_commit"`
	URL          string `json:"url"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
}

type ApplicationUpdate struct {
	Version      string
	SourceCommit string
	StagedPath   string
	SHA256       string
	Size         int64
}

func validateApplicationURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("application URL must be canonical HTTPS github.com URL")
	}
	if parsed.Path != "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/OrdaX-Creator.exe" {
		return errors.New("application URL must point to the canonical creator-dev OrdaX-Creator.exe asset")
	}
	return nil
}

func ValidateApplicationManifest(value ApplicationManifest) error {
	if value.Schema != ApplicationSchema {
		return fmt.Errorf("unsupported application update schema %q", value.Schema)
	}
	if value.Channel != DevelopmentChannel {
		return fmt.Errorf("development Creator refuses application channel %q", value.Channel)
	}
	if !versionPattern.MatchString(value.Version) {
		return errors.New("invalid application update version")
	}
	if !commitPattern.MatchString(value.SourceCommit) {
		return errors.New("application source_commit must be lowercase 40-hex")
	}
	if !shaPattern.MatchString(value.SHA256) {
		return errors.New("application SHA-256 must be lowercase 64-hex")
	}
	if value.Size <= 0 || value.Size > maxApplicationBytes {
		return errors.New("application size outside allowed range")
	}
	return validateApplicationURL(value.URL)
}

func decodeApplicationManifest(data []byte) (ApplicationManifest, error) {
	if len(data) == 0 || len(data) > maxApplicationManifest {
		return ApplicationManifest{}, errors.New("application manifest size outside allowed range")
	}
	var value ApplicationManifest
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return ApplicationManifest{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return ApplicationManifest{}, errors.New("multiple application manifest JSON values are forbidden")
		}
		return ApplicationManifest{}, err
	}
	if err := ValidateApplicationManifest(value); err != nil {
		return ApplicationManifest{}, err
	}
	return value, nil
}

func FetchApplicationManifest(client *http.Client, manifestURL string) (ApplicationManifest, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if manifestURL == "" {
		manifestURL = DefaultApplicationURL
	}
	separator := "?"
	if strings.Contains(manifestURL, "?") {
		separator = "&"
	}
	data, err := fetchBytes(client, manifestURL+separator+"ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), maxApplicationManifest)
	if err != nil {
		return ApplicationManifest{}, err
	}
	return decodeApplicationManifest(data)
}

func verifyRegularSHA256(path, expected string, expectedSize int64) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != expectedSize {
		return errors.New("staged application file size/type mismatch")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return err
	}
	if actual := hex.EncodeToString(h.Sum(nil)); actual != expected {
		return fmt.Errorf("staged application SHA-256 mismatch: expected=%s actual=%s", expected, actual)
	}
	return nil
}

func stageApplicationDownload(client *http.Client, value ApplicationManifest, destination string) error {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	request, err := http.NewRequest(http.MethodGet, value.URL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "OrdaX-Creator-Self-Updater/1")
	request.Header.Set("Cache-Control", "no-cache")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d while downloading Creator application", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700)
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
	n, err := io.Copy(io.MultiWriter(file, h), io.LimitReader(response.Body, value.Size+1))
	if err != nil {
		return err
	}
	if n != value.Size {
		return fmt.Errorf("application size mismatch: expected=%d actual=%d", value.Size, n)
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != value.SHA256 {
		return fmt.Errorf("application SHA-256 mismatch: expected=%s actual=%s", value.SHA256, actual)
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

// StageApplicationUpdate downloads a newer Creator executable next to the
// currently running executable so the Windows replacement helper can perform an
// atomic same-volume swap after the current process exits.
func StageApplicationUpdate(client *http.Client, manifestURL, currentCommit, executablePath string) (ApplicationUpdate, bool, error) {
	if !commitPattern.MatchString(currentCommit) {
		return ApplicationUpdate{}, false, errors.New("current Creator build commit is unresolved")
	}
	value, err := FetchApplicationManifest(client, manifestURL)
	if err != nil {
		return ApplicationUpdate{}, false, err
	}
	if value.SourceCommit == currentCommit {
		return ApplicationUpdate{}, false, nil
	}
	absolute, err := filepath.Abs(executablePath)
	if err != nil {
		return ApplicationUpdate{}, false, err
	}
	parent := filepath.Dir(absolute)
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return ApplicationUpdate{}, false, errors.New("Creator executable parent directory is unavailable")
	}
	staged := filepath.Join(parent, ".OrdaX-Creator-"+value.SourceCommit[:12]+".next.exe")
	if err := verifyRegularSHA256(staged, value.SHA256, value.Size); err == nil {
		return ApplicationUpdate{Version: value.Version, SourceCommit: value.SourceCommit, StagedPath: staged, SHA256: value.SHA256, Size: value.Size}, true, nil
	}
	_ = os.Remove(staged)
	if err := stageApplicationDownload(client, value, staged); err != nil {
		return ApplicationUpdate{}, false, err
	}
	return ApplicationUpdate{Version: value.Version, SourceCommit: value.SourceCommit, StagedPath: staged, SHA256: value.SHA256, Size: value.Size}, true, nil
}
