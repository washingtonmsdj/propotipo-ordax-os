package main

import (
	"archive/tar"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	envelopeSchema = "prototype-ordax.release-envelope/1"
	manifestSchema = "prototype-ordax.release-manifest/1"
	trustSchema    = "prototype-ordax.release-trust/1"
	defaultRepo    = "washingtonmsdj/prototipo-ordax-os"
	maxEnvelope    = 1 << 20
	maxPayload     = 512 << 10
	maxArtifact    = int64(16 << 30)
)

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	namePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$`)
	rolePattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	recipePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
)

type Envelope struct {
	Schema    string `json:"$schema"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
	KeyID     string `json:"key_id"`
}

type Manifest struct {
	Schema              string     `json:"$schema"`
	SourceRepository    string     `json:"source_repository"`
	SourceCommit        string     `json:"source_commit"`
	ReleaseID           string     `json:"release_id"`
	CreatedFromCIRecipe string     `json:"created_from_ci_recipe"`
	Artifacts           []Artifact `json:"artifacts"`
}

type Artifact struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type TrustAnchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type Receipt struct {
	Status       string   `json:"status"`
	SourceCommit string   `json:"source_commit"`
	ReleasePath  string   `json:"release_path"`
	CurrentPath  string   `json:"current_path"`
	Artifacts    []string `json:"artifacts"`
	Idempotent   bool     `json:"idempotent"`
}

func strictDecode(data []byte, max int, out any) error {
	if len(data) == 0 || len(data) > max {
		return fmt.Errorf("document size outside allowed range: %d", len(data))
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}

func loadTrust(path string) (TrustAnchor, ed25519.PublicKey, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 16<<10 {
		return TrustAnchor{}, nil, errors.New("trust anchor must be a small regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return TrustAnchor{}, nil, err
	}
	var trust TrustAnchor
	if err := strictDecode(data, 16<<10, &trust); err != nil {
		return TrustAnchor{}, nil, fmt.Errorf("invalid trust anchor: %w", err)
	}
	if trust.Schema != trustSchema || !rolePattern.MatchString(trust.KeyID) {
		return TrustAnchor{}, nil, errors.New("unsupported trust anchor schema or key id")
	}
	key, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return TrustAnchor{}, nil, errors.New("invalid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(key), nil
}

func verifyEnvelope(data []byte, trust TrustAnchor, key ed25519.PublicKey, expectedRepo string) (Manifest, []byte, error) {
	var envelope Envelope
	if err := strictDecode(data, maxEnvelope, &envelope); err != nil {
		return Manifest{}, nil, fmt.Errorf("invalid envelope: %w", err)
	}
	if envelope.Schema != envelopeSchema {
		return Manifest{}, nil, errors.New("unsupported release envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return Manifest{}, nil, errors.New("release key id does not match trust anchor")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxPayload {
		return Manifest{}, nil, errors.New("signed manifest payload is outside allowed size")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return Manifest{}, nil, errors.New("release manifest signature verification failed")
	}
	var manifest Manifest
	if err := strictDecode(envelope.Payload, maxPayload, &manifest); err != nil {
		return Manifest{}, nil, fmt.Errorf("invalid signed manifest: %w", err)
	}
	if err := validateManifest(manifest, expectedRepo); err != nil {
		return Manifest{}, nil, err
	}
	return manifest, envelope.Payload, nil
}

func validateManifest(m Manifest, expectedRepo string) error {
	if m.Schema != manifestSchema {
		return errors.New("unsupported release manifest schema")
	}
	if m.SourceRepository != expectedRepo {
		return fmt.Errorf("unexpected source repository: %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("source_commit must be lowercase 40-hex")
	}
	if m.ReleaseID != m.SourceCommit {
		return errors.New("prototype release_id must equal source_commit")
	}
	if !recipePattern.MatchString(m.CreatedFromCIRecipe) {
		return errors.New("invalid created_from_ci_recipe")
	}
	if len(m.Artifacts) != 1 {
		return errors.New("release-manifest/1 requires exactly one system.tar artifact")
	}
	a := m.Artifacts[0]
	if a.Name != "system.tar" || a.Role != "system" {
		return errors.New("release-manifest/1 artifact must be system.tar with role=system")
	}
	if !namePattern.MatchString(a.Name) || filepath.Base(a.Name) != a.Name || strings.ContainsAny(a.Name, `/\\`) {
		return fmt.Errorf("unsafe artifact name: %q", a.Name)
	}
	if !rolePattern.MatchString(a.Role) {
		return fmt.Errorf("invalid artifact role: %q", a.Role)
	}
	if !shaPattern.MatchString(a.SHA256) {
		return fmt.Errorf("invalid artifact SHA-256 for %q", a.Name)
	}
	if a.Size <= 0 || a.Size > maxArtifact {
		return fmt.Errorf("artifact size outside allowed range for %q", a.Name)
	}
	if err := validateHTTPSURL(a.URL); err != nil {
		return fmt.Errorf("artifact %q: %w", a.Name, err)
	}
	return nil
}

func validateHTTPSURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return errors.New("URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func secureClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return errors.New("redirect to non-HTTPS URL refused")
			}
			return nil
		},
	}
}

func fetchBytes(client *http.Client, raw string, max int64) ([]byte, error) {
	if err := validateHTTPSURL(raw); err != nil {
		return nil, err
	}
	resp, err := client.Get(raw)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL.Scheme != "https" {
		return nil, errors.New("final response is not HTTPS")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected HTTP status: %s", resp.Status)
	}
	if resp.ContentLength > max {
		return nil, errors.New("response exceeds maximum size")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, errors.New("response exceeds maximum size")
	}
	return data, nil
}

func ensureDir(path string, mode os.FileMode) error {
	if err := os.MkdirAll(path, mode); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe directory: %s", path)
	}
	return nil
}

func downloadArtifact(client *http.Client, a Artifact, dst string) error {
	resp, err := client.Get(a.URL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL.Scheme != "https" {
		return errors.New("artifact final response is not HTTPS")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("artifact HTTP status: %s", resp.Status)
	}
	if resp.ContentLength >= 0 && resp.ContentLength != a.Size {
		return fmt.Errorf("artifact Content-Length mismatch for %s", a.Name)
	}
	file, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	var h hash.Hash = sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(file, h), io.LimitReader(resp.Body, a.Size+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != a.Size {
		return fmt.Errorf("artifact size mismatch for %s: got=%d expected=%d", a.Name, n, a.Size)
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != a.SHA256 {
		return fmt.Errorf("artifact SHA-256 mismatch for %s", a.Name)
	}
	return nil
}

func systemArchivePathName(header *tar.Header) (string, os.FileMode, error) {
	name := strings.TrimSuffix(header.Name, "/")
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || pathpkg.Clean(name) != name {
		return "", 0, fmt.Errorf("unsafe system archive path: %q", header.Name)
	}
	if name != "system" && !strings.HasPrefix(name, "system/") {
		return "", 0, fmt.Errorf("system archive entry escapes system/: %q", header.Name)
	}
	mode := os.FileMode(header.Mode) & os.ModePerm
	switch header.Typeflag {
	case tar.TypeDir:
		if mode != 0o755 {
			return "", 0, fmt.Errorf("system archive directory mode must be 0755: %s", name)
		}
	case tar.TypeReg, tar.TypeRegA:
		if name == "system" {
			return "", 0, errors.New("system archive root must be a directory")
		}
		if mode != 0o644 && mode != 0o755 {
			return "", 0, fmt.Errorf("system archive file mode must be 0644 or 0755: %s", name)
		}
		if header.Size < 0 || header.Size > maxArtifact {
			return "", 0, fmt.Errorf("system archive entry size outside allowed range: %s", name)
		}
	default:
		return "", 0, fmt.Errorf("system archive entry type is forbidden: %s", name)
	}
	return name, mode, nil
}

func extractSystemArchive(archivePath, releaseRoot string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := tar.NewReader(file)
	seen := map[string]bool{}
	var total int64
	entrypointSeen := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read system archive: %w", err)
		}
		name, mode, err := systemArchivePathName(header)
		if err != nil {
			return err
		}
		if seen[name] {
			return fmt.Errorf("duplicate system archive path: %s", name)
		}
		seen[name] = true
		target := filepath.Join(releaseRoot, filepath.FromSlash(name))
		switch header.Typeflag {
		case tar.TypeDir:
			if err := ensureDir(target, mode); err != nil {
				return err
			}
			if err := os.Chmod(target, mode); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			total += header.Size
			if total > maxArtifact {
				return errors.New("system archive extracted size exceeds allowed maximum")
			}
			if err := ensureDir(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
			if err != nil {
				return err
			}
			n, copyErr := io.Copy(output, reader)
			syncErr := output.Sync()
			closeErr := output.Close()
			if copyErr != nil {
				return copyErr
			}
			if syncErr != nil {
				return syncErr
			}
			if closeErr != nil {
				return closeErr
			}
			if n != header.Size {
				return fmt.Errorf("system archive entry size mismatch: %s", name)
			}
			if name == "system/entrypoint" {
				if mode != 0o755 || header.Size == 0 {
					return errors.New("system/entrypoint must be a non-empty 0755 regular file")
				}
				entrypointSeen = true
			}
		}
	}
	if !entrypointSeen {
		return errors.New("system archive does not contain executable system/entrypoint")
	}
	if err := syncDir(filepath.Join(releaseRoot, "system")); err != nil {
		return err
	}
	return verifySystemArchiveAgainstTree(archivePath, releaseRoot)
}

func hashFile(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("path is not a regular non-symlink file")
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

func verifySystemArchiveAgainstTree(archivePath, releaseRoot string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := tar.NewReader(file)
	expectedFiles := map[string]bool{}
	expectedDirs := map[string]bool{"system": true}
	entrypointSeen := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read system archive for verification: %w", err)
		}
		name, mode, err := systemArchivePathName(header)
		if err != nil {
			return err
		}
		target := filepath.Join(releaseRoot, filepath.FromSlash(name))
		switch header.Typeflag {
		case tar.TypeDir:
			expectedDirs[name] = true
			info, err := os.Lstat(target)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != mode {
				return fmt.Errorf("materialized system directory differs: %s", name)
			}
		case tar.TypeReg, tar.TypeRegA:
			expectedFiles[name] = true
			for parent := pathpkg.Dir(name); parent != "." && strings.HasPrefix(parent, "system"); parent = pathpkg.Dir(parent) {
				expectedDirs[parent] = true
				if parent == "system" {
					break
				}
			}
			expectedHash := sha256.New()
			n, err := io.Copy(expectedHash, reader)
			if err != nil || n != header.Size {
				return fmt.Errorf("cannot hash archive entry %s", name)
			}
			actualHash, actualSize, err := hashFile(target)
			if err != nil || actualSize != header.Size || actualHash != hex.EncodeToString(expectedHash.Sum(nil)) {
				return fmt.Errorf("materialized system file differs: %s", name)
			}
			info, err := os.Lstat(target)
			if err != nil || info.Mode().Perm() != mode {
				return fmt.Errorf("materialized system file mode differs: %s", name)
			}
			if name == "system/entrypoint" {
				if mode != 0o755 || header.Size == 0 {
					return errors.New("materialized system/entrypoint is not bootable")
				}
				entrypointSeen = true
			}
		}
	}
	if !entrypointSeen {
		return errors.New("materialized release lacks system/entrypoint")
	}
	systemRoot := filepath.Join(releaseRoot, "system")
	return filepath.WalkDir(systemRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(releaseRoot, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("materialized system contains symlink: %s", name)
		}
		if entry.IsDir() {
			if !expectedDirs[name] {
				return fmt.Errorf("materialized system contains unexpected directory: %s", name)
			}
			return nil
		}
		if !info.Mode().IsRegular() || !expectedFiles[name] {
			return fmt.Errorf("materialized system contains unexpected file: %s", name)
		}
		return nil
	})
}

func verifyExistingRelease(path string, m Manifest, payload []byte) error {
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	allowed := map[string]bool{"artifacts": true, "release-manifest.json": true, "system": true}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return fmt.Errorf("existing release contains unexpected top-level entry: %s", entry.Name())
		}
	}
	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("existing release manifest differs from signed payload")
	}
	artifactRoot := filepath.Join(path, "artifacts")
	artifactEntries, err := os.ReadDir(artifactRoot)
	if err != nil || len(artifactEntries) != len(m.Artifacts) {
		return errors.New("existing release artifact directory differs from signed manifest")
	}
	for _, a := range m.Artifacts {
		p := filepath.Join(artifactRoot, a.Name)
		actualHash, actualSize, err := hashFile(p)
		if err != nil || actualSize != a.Size {
			return fmt.Errorf("existing artifact invalid: %s", a.Name)
		}
		if actualHash != a.SHA256 {
			return fmt.Errorf("existing artifact digest mismatch: %s", a.Name)
		}
		if err := verifySystemArchiveAgainstTree(p, path); err != nil {
			return err
		}
	}
	return nil
}

func syncDir(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func writeSynced(path string, data []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func activate(root, commit string) error {
	current := filepath.Join(root, "current")
	if info, err := os.Lstat(current); err == nil {
		if info.Mode()&os.ModeSymlink == 0 {
			return errors.New("current exists and is not a symlink")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmpFile, err := os.CreateTemp(root, ".current-next-")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Remove(tmp); err != nil {
		return err
	}
	defer os.Remove(tmp)
	if err := os.Symlink(filepath.Join("releases", commit), tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, current); err != nil {
		return err
	}
	return syncDir(root)
}

func install(client *http.Client, envelopeURL, root string, trust TrustAnchor, key ed25519.PublicKey, expectedRepo string) (Receipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return Receipt{}, fmt.Errorf("fetch envelope: %w", err)
	}
	manifest, payload, err := verifyEnvelope(envelope, trust, key, expectedRepo)
	if err != nil {
		return Receipt{}, err
	}
	if err := ensureDir(root, 0o755); err != nil {
		return Receipt{}, err
	}
	releases := filepath.Join(root, "releases")
	if err := ensureDir(releases, 0o755); err != nil {
		return Receipt{}, err
	}
	target := filepath.Join(releases, manifest.SourceCommit)
	artifactNames := make([]string, 0, len(manifest.Artifacts))
	for _, a := range manifest.Artifacts {
		artifactNames = append(artifactNames, a.Name)
	}
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return Receipt{}, errors.New("release target exists but is not a safe directory")
		}
		if err := verifyExistingRelease(target, manifest, payload); err != nil {
			return Receipt{}, err
		}
		if err := activate(root, manifest.SourceCommit); err != nil {
			return Receipt{}, err
		}
		return Receipt{"activated", manifest.SourceCommit, target, filepath.Join(root, "current"), artifactNames, true}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Receipt{}, err
	}
	stage, err := os.MkdirTemp(releases, ".staging-"+manifest.SourceCommit+"-")
	if err != nil {
		return Receipt{}, err
	}
	keepStage := false
	defer func() {
		if !keepStage {
			_ = os.RemoveAll(stage)
		}
	}()
	artifactRoot := filepath.Join(stage, "artifacts")
	if err := os.Mkdir(artifactRoot, 0o755); err != nil {
		return Receipt{}, err
	}
	for _, a := range manifest.Artifacts {
		archivePath := filepath.Join(artifactRoot, a.Name)
		if err := downloadArtifact(client, a, archivePath); err != nil {
			return Receipt{}, err
		}
		if err := extractSystemArchive(archivePath, stage); err != nil {
			return Receipt{}, fmt.Errorf("materialize %s: %w", a.Name, err)
		}
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return Receipt{}, err
	}
	if err := verifyExistingRelease(stage, manifest, payload); err != nil {
		return Receipt{}, fmt.Errorf("verify staged release: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return Receipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return Receipt{}, err
	}
	keepStage = true
	if err := syncDir(releases); err != nil {
		return Receipt{}, err
	}
	if err := activate(root, manifest.SourceCommit); err != nil {
		return Receipt{}, err
	}
	return Receipt{"activated", manifest.SourceCommit, target, filepath.Join(root, "current"), artifactNames, false}, nil
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func verifyCommand(args []string) error {
	fs := flag.NewFlagSet("verify-envelope", flag.ContinueOnError)
	envelopePath := fs.String("envelope", "", "signed release envelope file")
	trustPath := fs.String("trust", "", "release trust anchor file")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("verify-envelope requires --envelope and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*envelopePath)
	if err != nil {
		return err
	}
	manifest, _, err := verifyEnvelope(data, trust, key, *repository)
	if err != nil {
		return err
	}
	return printJSON(map[string]any{"status": "verified", "source_commit": manifest.SourceCommit, "artifact_count": len(manifest.Artifacts)})
}

func installCommand(args []string) error {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed release envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/ordax", "OrdaX root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("install requires --envelope-url and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := install(secureClient(), *envelopeURL, *root, trust, key, *repository)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-release-agent <verify-envelope|install> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "verify-envelope":
		err = verifyCommand(os.Args[2:])
	case "install":
		err = installCommand(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-agent: ERROR:", err)
		os.Exit(1)
	}
}
