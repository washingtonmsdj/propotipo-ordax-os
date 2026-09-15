package main

import (
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
	if len(m.Artifacts) == 0 || len(m.Artifacts) > 128 {
		return errors.New("release must contain between 1 and 128 artifacts")
	}
	seen := make(map[string]struct{}, len(m.Artifacts))
	for _, a := range m.Artifacts {
		if !namePattern.MatchString(a.Name) || a.Name == "release-manifest.json" {
			return fmt.Errorf("unsafe artifact name: %q", a.Name)
		}
		if filepath.Base(a.Name) != a.Name || strings.ContainsAny(a.Name, `/\\`) {
			return fmt.Errorf("artifact name must be a basename: %q", a.Name)
		}
		if _, ok := seen[a.Name]; ok {
			return fmt.Errorf("duplicate artifact name: %q", a.Name)
		}
		seen[a.Name] = struct{}{}
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

func verifyExistingRelease(path string, m Manifest, payload []byte) error {
	manifestPath := filepath.Join(path, "release-manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil || !bytes.Equal(data, payload) {
		return errors.New("existing release manifest differs from signed payload")
	}
	for _, a := range m.Artifacts {
		p := filepath.Join(path, a.Name)
		info, err := os.Lstat(p)
		if err != nil || !info.Mode().IsRegular() || info.Size() != a.Size {
			return fmt.Errorf("existing artifact invalid: %s", a.Name)
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		h := sha256.New()
		_, copyErr := io.Copy(h, f)
		closeErr := f.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
			return fmt.Errorf("existing artifact digest mismatch: %s", a.Name)
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
	for _, a := range manifest.Artifacts {
		if err := downloadArtifact(client, a, filepath.Join(stage, a.Name)); err != nil {
			return Receipt{}, err
		}
	}
	if err := writeSynced(filepath.Join(stage, "release-manifest.json"), payload, 0o644); err != nil {
		return Receipt{}, err
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
