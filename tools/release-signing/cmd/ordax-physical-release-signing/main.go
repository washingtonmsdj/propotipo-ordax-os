package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

const (
	envelopeSchema   = "prototype-ordax.creator-physical-envelope/1"
	manifestSchema   = "prototype-ordax.creator-physical-manifest/1"
	trustSchema      = "prototype-ordax.release-trust/1"
	purpose          = "creator-physical-windows-amd64"
	repository       = "washingtonmsdj/prototipo-ordax-os"
	recipe           = "creator/physical/windows/1"
	bundlePathPrefix = "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/"
	maxDocument      = 512 << 10
	maxPrivateKey    = 16 << 10
	maxTrust         = 16 << 10
	maxArtifact      = int64(2 << 30)
)

var (
	keyIDPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type trustAnchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type envelope struct {
	Schema    string `json:"$schema"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
	KeyID     string `json:"key_id"`
}

type fileBinding struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type bundle struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type manifest struct {
	Schema            string        `json:"$schema"`
	Purpose           string        `json:"purpose"`
	SourceRepository  string        `json:"source_repository"`
	SourceCommit      string        `json:"source_commit"`
	CreatedFromRecipe string        `json:"created_from_recipe"`
	Bundle            bundle        `json:"bundle"`
	Files             []fileBinding `json:"files"`
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

func readRegular(path string, max int64, secret bool) ([]byte, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	parent := filepath.Dir(absolute)
	parentInfo, err := os.Lstat(parent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("parent must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || filepath.Clean(resolved) != filepath.Clean(parent) {
		return nil, errors.New("path may not traverse symlinks")
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("input must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > max {
		return nil, fmt.Errorf("input size outside allowed range: %d", info.Size())
	}
	if secret && runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("private key permissions are too broad: %04o", info.Mode().Perm())
	}
	return os.ReadFile(absolute)
}

func validateManifest(data []byte) (manifest, error) {
	var m manifest
	if err := decodeStrict(data, maxDocument, &m); err != nil {
		return manifest{}, err
	}
	if m.Schema != manifestSchema || m.Purpose != purpose || m.SourceRepository != repository || m.CreatedFromRecipe != recipe {
		return manifest{}, errors.New("physical manifest identity/purpose is not canonical")
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return manifest{}, errors.New("source_commit must be lowercase 40-hex")
	}
	if !shaPattern.MatchString(m.Bundle.SHA256) || m.Bundle.Size <= 0 || m.Bundle.Size > maxArtifact {
		return manifest{}, errors.New("physical bundle binding is invalid")
	}
	parsed, err := url.Parse(m.Bundle.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" || !strings.HasPrefix(parsed.Path, bundlePathPrefix) {
		return manifest{}, errors.New("physical bundle URL is outside the canonical creator-physical release")
	}
	expected := expectedFiles()
	if len(m.Files) != len(expected) {
		return manifest{}, fmt.Errorf("physical manifest requires exactly %d files", len(expected))
	}
	seen := map[string]struct{}{}
	for _, file := range m.Files {
		if _, ok := expected[file.Name]; !ok {
			return manifest{}, fmt.Errorf("unexpected physical file %q", file.Name)
		}
		if _, duplicate := seen[file.Name]; duplicate {
			return manifest{}, fmt.Errorf("duplicate physical file %q", file.Name)
		}
		seen[file.Name] = struct{}{}
		if !shaPattern.MatchString(file.SHA256) || file.Size <= 0 || file.Size > maxArtifact {
			return manifest{}, fmt.Errorf("invalid binding for physical file %q", file.Name)
		}
	}
	return m, nil
}

func loadPrivate(path string) (ed25519.PrivateKey, error) {
	data, err := readRegular(path, maxPrivateKey, true)
	if err != nil {
		return nil, err
	}
	block, rest := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("private key must contain exactly one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("private key is not Ed25519")
	}
	return key, nil
}

func loadTrust(path string) (trustAnchor, ed25519.PublicKey, error) {
	data, err := readRegular(path, maxTrust, false)
	if err != nil {
		return trustAnchor{}, nil, err
	}
	var trust trustAnchor
	if err := decodeStrict(data, maxTrust, &trust); err != nil {
		return trustAnchor{}, nil, err
	}
	if trust.Schema != trustSchema || !keyIDPattern.MatchString(trust.KeyID) {
		return trustAnchor{}, nil, errors.New("invalid release trust anchor")
	}
	public, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return trustAnchor{}, nil, errors.New("invalid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(public), nil
}

func writeExclusive(path string, data []byte) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	parent := filepath.Dir(absolute)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	if _, err := os.Lstat(absolute); err == nil {
		return errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	remove := true
	defer func() { if remove { _ = os.Remove(absolute) } }()
	if _, err := file.Write(data); err != nil { _ = file.Close(); return err }
	if err := file.Sync(); err != nil { _ = file.Close(); return err }
	if err := file.Close(); err != nil { return err }
	remove = false
	return nil
}

func signPhysical(manifestPath, privatePath, trustPath, outputPath, keyID string) (string, error) {
	if !keyIDPattern.MatchString(keyID) {
		return "", errors.New("invalid key id")
	}
	manifestBytes, err := readRegular(manifestPath, maxDocument, false)
	if err != nil { return "", fmt.Errorf("manifest: %w", err) }
	m, err := validateManifest(manifestBytes)
	if err != nil { return "", err }
	privateKey, err := loadPrivate(privatePath)
	if err != nil { return "", fmt.Errorf("private key: %w", err) }
	trust, publicKey, err := loadTrust(trustPath)
	if err != nil { return "", fmt.Errorf("trust: %w", err) }
	if trust.KeyID != keyID {
		return "", errors.New("key id does not match trust anchor")
	}
	derived := privateKey.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, publicKey) {
		return "", errors.New("private key does not match canonical trust anchor")
	}
	signature := ed25519.Sign(privateKey, manifestBytes)
	envelopeBytes, err := json.MarshalIndent(envelope{Schema: envelopeSchema, Payload: manifestBytes, Signature: signature, KeyID: keyID}, "", "  ")
	if err != nil { return "", err }
	envelopeBytes = append(envelopeBytes, '\n')
	if err := writeExclusive(outputPath, envelopeBytes); err != nil { return "", err }
	return m.SourceCommit, nil
}

func main() {
	flags := flag.NewFlagSet("ordax-physical-release-signing", flag.ExitOnError)
	manifestPath := flags.String("manifest", "", "canonical creator physical manifest")
	privatePath := flags.String("private-key", "", "external canonical Ed25519 private key")
	trustPath := flags.String("trust", "", "canonical public release trust anchor")
	outputPath := flags.String("out", "", "new creator physical signed envelope")
	keyID := flags.String("key-id", "", "canonical release key id")
	_ = flags.Parse(os.Args[1:])
	if flags.NArg() != 0 || *manifestPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" {
		fmt.Fprintln(os.Stderr, "usage: ordax-physical-release-signing --manifest FILE --private-key FILE --trust FILE --out FILE --key-id ID")
		os.Exit(2)
	}
	commit, err := signPhysical(*manifestPath, *privatePath, *trustPath, *outputPath, *keyID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-physical-release-signing: ERROR:", err)
		os.Exit(1)
	}
	files := make([]string, 0, len(expectedFiles()))
	for name := range expectedFiles() { files = append(files, name) }
	sort.Strings(files)
	fmt.Printf("PHYSICAL_ENVELOPE_SIGNED=YES\nSOURCE_COMMIT=%s\nPURPOSE=%s\nBOUND_FILES=%s\nPRIVATE_KEY_PRINTED=NO\n", commit, purpose, strings.Join(files, ","))
}
