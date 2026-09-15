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
	"strings"
)

const (
	envelopeSchema   = "prototype-ordax.creator-component-envelope/1"
	manifestSchema   = "prototype-ordax.creator-component-manifest/1"
	trustSchema      = "prototype-ordax.release-trust/1"
	purpose          = "creator-inspection-windows-amd64"
	repository       = "washingtonmsdj/prototipo-ordax-os"
	recipe           = "creator/component/windows/1"
	bundleName       = "ordax-creator-components-windows-amd64.zip"
	componentName    = "ordax-creator-physical-test.exe"
	bundlePathPrefix = "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/"
	maxDocument      = 256 << 10
	maxPrivateKey    = 16 << 10
	maxTrust         = 16 << 10
	maxBundle        = int64(64 << 20)
	maxComponent     = int64(32 << 20)
)

var (
	keyIDPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
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
	Schema            string      `json:"$schema"`
	Purpose           string      `json:"purpose"`
	SourceRepository  string      `json:"source_repository"`
	SourceCommit      string      `json:"source_commit"`
	Version           string      `json:"version"`
	ReleaseSequence   int64       `json:"release_sequence"`
	CreatedFromRecipe string      `json:"created_from_recipe"`
	Bundle            bundle      `json:"bundle"`
	File              fileBinding `json:"file"`
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
		return manifest{}, errors.New("Creator component manifest identity/purpose is not canonical")
	}
	if !commitPattern.MatchString(m.SourceCommit) || !versionPattern.MatchString(m.Version) || m.ReleaseSequence <= 0 {
		return manifest{}, errors.New("Creator component source/version/sequence is invalid")
	}
	if !shaPattern.MatchString(m.Bundle.SHA256) || m.Bundle.Size <= 0 || m.Bundle.Size > maxBundle {
		return manifest{}, errors.New("Creator component bundle binding is invalid")
	}
	parsed, err := url.Parse(m.Bundle.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || parsed.Path != bundlePathPrefix+bundleName {
		return manifest{}, errors.New("Creator component bundle URL is outside the canonical creator-components release")
	}
	if m.File.Name != componentName || !shaPattern.MatchString(m.File.SHA256) || m.File.Size <= 0 || m.File.Size > maxComponent {
		return manifest{}, errors.New("Creator component file binding is invalid")
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
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func signComponent(manifestPath, privatePath, trustPath, outputPath, keyID string) (manifest, error) {
	if !keyIDPattern.MatchString(keyID) {
		return manifest{}, errors.New("invalid key id")
	}
	manifestBytes, err := readRegular(manifestPath, maxDocument, false)
	if err != nil {
		return manifest{}, fmt.Errorf("manifest: %w", err)
	}
	m, err := validateManifest(manifestBytes)
	if err != nil {
		return manifest{}, err
	}
	privateKey, err := loadPrivate(privatePath)
	if err != nil {
		return manifest{}, fmt.Errorf("private key: %w", err)
	}
	trust, publicKey, err := loadTrust(trustPath)
	if err != nil {
		return manifest{}, fmt.Errorf("trust: %w", err)
	}
	if trust.KeyID != keyID {
		return manifest{}, errors.New("key id does not match trust anchor")
	}
	derived := privateKey.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, publicKey) {
		return manifest{}, errors.New("private key does not match canonical trust anchor")
	}
	signature := ed25519.Sign(privateKey, manifestBytes)
	envelopeBytes, err := json.MarshalIndent(envelope{Schema: envelopeSchema, Payload: manifestBytes, Signature: signature, KeyID: keyID}, "", "  ")
	if err != nil {
		return manifest{}, err
	}
	envelopeBytes = append(envelopeBytes, '\n')
	if err := writeExclusive(outputPath, envelopeBytes); err != nil {
		return manifest{}, err
	}
	return m, nil
}

func main() {
	flags := flag.NewFlagSet("ordax-creator-component-signing", flag.ExitOnError)
	manifestPath := flags.String("manifest", "", "canonical Creator component manifest")
	privatePath := flags.String("private-key", "", "external canonical Ed25519 private key")
	trustPath := flags.String("trust", "", "canonical public release trust anchor")
	outputPath := flags.String("out", "", "new signed Creator component envelope")
	keyID := flags.String("key-id", "", "canonical release key id")
	_ = flags.Parse(os.Args[1:])
	if flags.NArg() != 0 || *manifestPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" {
		fmt.Fprintln(os.Stderr, "usage: ordax-creator-component-signing --manifest FILE --private-key FILE --trust FILE --out FILE --key-id ID")
		os.Exit(2)
	}
	m, err := signComponent(*manifestPath, *privatePath, *trustPath, *outputPath, *keyID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-component-signing: ERROR:", err)
		os.Exit(1)
	}
	fmt.Printf("CREATOR_COMPONENT_ENVELOPE_SIGNED=YES\nSOURCE_COMMIT=%s\nVERSION=%s\nRELEASE_SEQUENCE=%d\nPURPOSE=%s\nPRIVATE_KEY_PRINTED=NO\n", m.SourceCommit, m.Version, m.ReleaseSequence, purpose)
}
