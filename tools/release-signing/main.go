package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
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
	envelopeSchema = "prototype-ordax.release-envelope/1"
	manifestSchema = "prototype-ordax.release-manifest/1"
	trustSchema    = "prototype-ordax.release-trust/1"
	defaultRepo    = "washingtonmsdj/prototipo-ordax-os"
	maxManifest    = 512 << 10
	maxPrivateKey  = 16 << 10
)

var (
	keyIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	namePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$`)
	rolePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	recipePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
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

func validateKeyID(keyID string) error {
	if !keyIDPattern.MatchString(keyID) {
		return errors.New("key id must match [a-z0-9][a-z0-9._-]{0,63}")
	}
	return nil
}

func ensureRealParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return "", fmt.Errorf("stat parent directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("parent must be a real directory, not a symlink")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", fmt.Errorf("resolve parent directory: %w", err)
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("resolve evaluated parent: %w", err)
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(parent) {
		return "", errors.New("parent path may not traverse symlinks")
	}
	return absolute, nil
}

func readRegular(path string, max int64, secret bool) ([]byte, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return nil, err
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
	data, err := os.ReadFile(absolute)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func ensureOutputAvailable(path string) (string, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(absolute); err == nil {
		return "", errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return absolute, nil
}

func writeExclusive(path string, data []byte, mode os.FileMode) error {
	absolute, err := ensureOutputAvailable(path)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
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
	if runtime.GOOS != "windows" {
		if err := os.Chmod(absolute, mode); err != nil {
			return err
		}
	}
	remove = false
	return nil
}

func marshalJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	data, err := readRegular(path, maxPrivateKey, true)
	if err != nil {
		return nil, fmt.Errorf("private key: %w", err)
	}
	block, rest := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("private key must contain exactly one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse PKCS#8 private key: %w", err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("private key is not Ed25519")
	}
	return privateKey, nil
}

func trustForPrivate(privateKey ed25519.PrivateKey, keyID string) (TrustAnchor, error) {
	if err := validateKeyID(keyID); err != nil {
		return TrustAnchor{}, err
	}
	publicKey, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok || len(publicKey) != ed25519.PublicKeySize {
		return TrustAnchor{}, errors.New("cannot derive Ed25519 public key")
	}
	return TrustAnchor{
		Schema:       trustSchema,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey),
	}, nil
}

func validateHTTPSURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func strictManifest(data []byte, expectedRepository string) (Manifest, error) {
	if len(data) == 0 || len(data) > maxManifest {
		return Manifest{}, fmt.Errorf("manifest size outside allowed range: %d", len(data))
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return Manifest{}, errors.New("manifest contains multiple JSON values")
		}
		return Manifest{}, err
	}
	if manifest.Schema != manifestSchema {
		return Manifest{}, errors.New("unsupported release manifest schema")
	}
	if manifest.SourceRepository != expectedRepository {
		return Manifest{}, fmt.Errorf("unexpected source repository: %q", manifest.SourceRepository)
	}
	if !commitPattern.MatchString(manifest.SourceCommit) {
		return Manifest{}, errors.New("source_commit must be lowercase 40-hex")
	}
	if manifest.ReleaseID != manifest.SourceCommit {
		return Manifest{}, errors.New("release_id must equal source_commit")
	}
	if !recipePattern.MatchString(manifest.CreatedFromCIRecipe) {
		return Manifest{}, errors.New("invalid created_from_ci_recipe")
	}
	if len(manifest.Artifacts) == 0 || len(manifest.Artifacts) > 128 {
		return Manifest{}, errors.New("release must contain between 1 and 128 artifacts")
	}
	seen := map[string]bool{}
	for _, artifact := range manifest.Artifacts {
		if !namePattern.MatchString(artifact.Name) || filepath.Base(artifact.Name) != artifact.Name || strings.ContainsAny(artifact.Name, `/\\`) || artifact.Name == "release-manifest.json" {
			return Manifest{}, fmt.Errorf("unsafe artifact name: %q", artifact.Name)
		}
		if seen[artifact.Name] {
			return Manifest{}, fmt.Errorf("duplicate artifact name: %q", artifact.Name)
		}
		seen[artifact.Name] = true
		if !rolePattern.MatchString(artifact.Role) {
			return Manifest{}, fmt.Errorf("invalid artifact role: %q", artifact.Role)
		}
		if !shaPattern.MatchString(artifact.SHA256) {
			return Manifest{}, fmt.Errorf("invalid artifact SHA-256 for %q", artifact.Name)
		}
		if artifact.Size <= 0 || artifact.Size > 16<<30 {
			return Manifest{}, fmt.Errorf("artifact size outside allowed range for %q", artifact.Name)
		}
		if err := validateHTTPSURL(artifact.URL); err != nil {
			return Manifest{}, fmt.Errorf("artifact %q: %w", artifact.Name, err)
		}
	}
	return manifest, nil
}

func generateKeyFiles(privatePath, trustPath, keyID string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	if privatePath == trustPath {
		return "", errors.New("private key and trust outputs must be different paths")
	}
	privateAbsolute, err := ensureOutputAvailable(privatePath)
	if err != nil {
		return "", fmt.Errorf("private key output: %w", err)
	}
	if _, err := ensureOutputAvailable(trustPath); err != nil {
		return "", fmt.Errorf("trust output: %w", err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return "", err
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	trust := TrustAnchor{Schema: trustSchema, KeyID: keyID, PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey)}
	trustBytes, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(privatePath, pemBytes, 0o600); err != nil {
		return "", fmt.Errorf("write private key: %w", err)
	}
	if err := writeExclusive(trustPath, trustBytes, 0o644); err != nil {
		_ = os.Remove(privateAbsolute)
		return "", fmt.Errorf("write trust anchor: %w", err)
	}
	digest := sha256.Sum256(publicKey)
	return hex.EncodeToString(digest[:]), nil
}

func deriveTrust(privatePath, outputPath, keyID string) (string, error) {
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	trust, err := trustForPrivate(privateKey, keyID)
	if err != nil {
		return "", err
	}
	data, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(outputPath, data, 0o644); err != nil {
		return "", err
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(publicKey)
	return hex.EncodeToString(digest[:]), nil
}

func signManifest(manifestPath, privatePath, outputPath, keyID, repository string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	manifestBytes, err := readRegular(manifestPath, maxManifest, false)
	if err != nil {
		return "", fmt.Errorf("manifest: %w", err)
	}
	manifest, err := strictManifest(manifestBytes, repository)
	if err != nil {
		return "", err
	}
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	signature := ed25519.Sign(privateKey, manifestBytes)
	envelope := Envelope{Schema: envelopeSchema, Payload: manifestBytes, Signature: signature, KeyID: keyID}
	envelopeBytes, err := marshalJSON(envelope)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(outputPath, envelopeBytes, 0o644); err != nil {
		return "", err
	}
	return manifest.SourceCommit, nil
}

func generateCommand(args []string) error {
	flags := flag.NewFlagSet("generate-key", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "new external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "new public trust-anchor JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *privatePath == "" || *trustPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("generate-key requires --private-key, --trust and --key-id")
	}
	fingerprint, err := generateKeyFiles(*privatePath, *trustPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf("KEY_GENERATED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func deriveCommand(args []string) error {
	flags := flag.NewFlagSet("derive-trust", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	outputPath := flags.String("out", "", "new public trust-anchor JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *privatePath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("derive-trust requires --private-key, --out and --key-id")
	}
	fingerprint, err := deriveTrust(*privatePath, *outputPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf("TRUST_DERIVED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func signCommand(args []string) error {
	flags := flag.NewFlagSet("sign", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "exact release manifest JSON path")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	outputPath := flags.String("out", "", "new release envelope JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *privatePath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign requires --manifest, --private-key, --out and --key-id")
	}
	commit, err := signManifest(*manifestPath, *privatePath, *outputPath, *keyID, *repository)
	if err != nil {
		return err
	}
	fmt.Printf("RELEASE_ENVELOPE_SIGNED=YES\nSOURCE_COMMIT=%s\nKEY_ID=%s\nPRIVATE_KEY_PRINTED=NO\n", commit, *keyID)
	return nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-release-signing <generate-key|derive-trust|sign> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "generate-key":
		err = generateCommand(os.Args[2:])
	case "derive-trust":
		err = deriveCommand(os.Args[2:])
	case "sign":
		err = signCommand(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-signing: ERROR:", err)
		os.Exit(1)
	}
}
