package main

import (
	"archive/zip"
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
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

const (
	envelopeSchema      = "prototype-ordax.runtime-component-envelope/1"
	releaseSchema       = "prototype-ordax.runtime-component-release/1"
	trustSchema         = "prototype-ordax.runtime-component-trust/1"
	packageSchema       = "prototype-ordax.runtime-component-package/1"
	sourceRepository    = "washingtonmsdj/prototipo-ordax-os"
	createdFromRecipe   = "runtime-component/package/1"
	packageManifestName = "component-package.json"
	slotEnvelopeName    = "runtime-component-envelope.json"
	defaultSlotRoot     = "/var/lib/ordax/components"

	maxReleaseBytes  = 256 << 10
	maxEnvelopeBytes = 1 << 20
	maxTrustBytes    = 16 << 10
	maxPrivateKey    = 16 << 10
	maxPackageBytes  = int64(32 << 20)
	maxFileBytes     = int64(2 << 20)
	maxTotalBytes    = int64(16 << 20)
	maxFiles         = 256
)

var (
	keyIDPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	componentPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
	commitPattern    = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern       = regexp.MustCompile(`^[0-9a-f]{64}$`)
	semverPattern    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`)
	fileNamePattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)
)

var forbiddenPackagePrefixes = []string{
	"system/adapters/",
	"system/apps/",
	"system/composition/",
	"system/surface/runtime/",
}

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

type releaseComponent struct {
	ID            string `json:"id"`
	Version       string `json:"version"`
	ReleaseMode   string `json:"release_mode"`
	PackageSchema string `json:"package_schema"`
}

type packageBinding struct {
	Name           string `json:"name"`
	SHA256         string `json:"sha256"`
	Size           int64  `json:"size"`
	ManifestSHA256 string `json:"manifest_sha256"`
}

type activationPolicy struct {
	DirectActivationAllowed bool `json:"direct_activation_allowed"`
	PendingHealthRequired    bool `json:"pending_health_required"`
}

type releaseDescriptor struct {
	Schema            string           `json:"$schema"`
	SourceRepository  string           `json:"source_repository"`
	SourceCommit      string           `json:"source_commit"`
	CreatedFromRecipe string           `json:"created_from_ci_recipe"`
	Component         releaseComponent `json:"component"`
	Package           packageBinding   `json:"package"`
	Activation        activationPolicy `json:"activation"`
}

type packageComponent struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Kind          string   `json:"kind"`
	Version       string   `json:"version"`
	ReleaseMode   string   `json:"releaseMode"`
	Criticality   string   `json:"criticality"`
	FailureDomain string   `json:"failureDomain"`
	RestartScope  string   `json:"restartScope"`
	HealthMode    string   `json:"healthMode"`
	Owner         string   `json:"owner"`
	Dependencies  []string `json:"dependencies"`
}

type packageFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type componentPackageManifest struct {
	Schema                            string           `json:"$schema"`
	Status                            string           `json:"status"`
	Component                         packageComponent `json:"component"`
	SourceCommit                      string           `json:"source_commit"`
	Entrypoint                        string           `json:"entrypoint"`
	SelfContainedSourceGraph          bool             `json:"self_contained_source_graph"`
	RemoteRuntimeDependencies         bool             `json:"remote_runtime_dependencies"`
	ActivationAllowed                 bool             `json:"activation_allowed"`
	SignatureRequiredBeforeActivation bool             `json:"signature_required_before_activation"`
	NativeAdaptersPackaged            bool             `json:"native_adapters_packaged"`
	CompositionPackaged               bool             `json:"composition_packaged"`
	Files                             []packageFile    `json:"files"`
}

type verifiedPackage struct {
	Manifest      componentPackageManifest
	ManifestBytes []byte
	Files         map[string][]byte
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

func validateKeyID(value string) error {
	if !keyIDPattern.MatchString(value) {
		return errors.New("key id must match [a-z0-9][a-z0-9._-]{0,63}")
	}
	return nil
}

func ensureRealParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("parent must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
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
	return os.ReadFile(absolute)
}

func outputPathAvailable(path string) (string, error) {
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

func writeExclusive(path string, payload []byte, mode os.FileMode) error {
	absolute, err := outputPathAvailable(path)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := file.Write(payload); err != nil {
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
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(payload, '\n'), nil
}

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	payload, err := readRegular(path, maxPrivateKey, true)
	if err != nil {
		return nil, fmt.Errorf("private key: %w", err)
	}
	block, rest := pem.Decode(payload)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("private key must contain exactly one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("private key is not Ed25519")
	}
	return key, nil
}

func loadTrustAnchor(path string) (trustAnchor, ed25519.PublicKey, error) {
	payload, err := readRegular(path, maxTrustBytes, false)
	if err != nil {
		return trustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	var trust trustAnchor
	if err := decodeStrict(payload, maxTrustBytes, &trust); err != nil {
		return trustAnchor{}, nil, fmt.Errorf("trust anchor: %w", err)
	}
	if trust.Schema != trustSchema {
		return trustAnchor{}, nil, errors.New("unsupported runtime component trust schema")
	}
	if err := validateKeyID(trust.KeyID); err != nil {
		return trustAnchor{}, nil, err
	}
	public, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return trustAnchor{}, nil, errors.New("runtime component trust contains an invalid Ed25519 public key")
	}
	return trust, ed25519.PublicKey(public), nil
}

func trustForPrivate(key ed25519.PrivateKey, keyID string) (trustAnchor, error) {
	if err := validateKeyID(keyID); err != nil {
		return trustAnchor{}, err
	}
	public, ok := key.Public().(ed25519.PublicKey)
	if !ok || len(public) != ed25519.PublicKeySize {
		return trustAnchor{}, errors.New("cannot derive Ed25519 public key")
	}
	return trustAnchor{
		Schema:       trustSchema,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	}, nil
}

func validateReleaseDescriptor(value releaseDescriptor) error {
	if value.Schema != releaseSchema {
		return errors.New("unsupported runtime component release schema")
	}
	if value.SourceRepository != sourceRepository {
		return errors.New("runtime component source repository is not canonical")
	}
	if !commitPattern.MatchString(value.SourceCommit) {
		return errors.New("runtime component source_commit must be lowercase 40-hex")
	}
	if value.CreatedFromRecipe != createdFromRecipe {
		return errors.New("runtime component release recipe is not canonical")
	}
	if !componentPattern.MatchString(value.Component.ID) {
		return errors.New("runtime component id is invalid")
	}
	if !semverPattern.MatchString(value.Component.Version) {
		return errors.New("runtime component version is invalid")
	}
	if value.Component.ReleaseMode != "bundled" && value.Component.ReleaseMode != "component-slot" {
		return errors.New("runtime component release mode is invalid")
	}
	if value.Component.PackageSchema != packageSchema {
		return errors.New("runtime component package schema is unsupported")
	}
	if !fileNamePattern.MatchString(value.Package.Name) || value.Package.Name != value.Component.ID+".zip" {
		return errors.New("runtime component package name is not canonical")
	}
	if !shaPattern.MatchString(value.Package.SHA256) || value.Package.Size <= 0 || value.Package.Size > maxPackageBytes {
		return errors.New("runtime component package binding is invalid")
	}
	if !shaPattern.MatchString(value.Package.ManifestSHA256) {
		return errors.New("runtime component package manifest binding is invalid")
	}
	if value.Activation.DirectActivationAllowed || !value.Activation.PendingHealthRequired {
		return errors.New("runtime component release must require pending health before activation")
	}
	return nil
}

func readReleaseDescriptor(path string) ([]byte, releaseDescriptor, error) {
	payload, err := readRegular(path, maxReleaseBytes, false)
	if err != nil {
		return nil, releaseDescriptor{}, err
	}
	var release releaseDescriptor
	if err := decodeStrict(payload, maxReleaseBytes, &release); err != nil {
		return nil, releaseDescriptor{}, err
	}
	if err := validateReleaseDescriptor(release); err != nil {
		return nil, releaseDescriptor{}, err
	}
	return payload, release, nil
}

func generateKey(privatePath, trustPath, keyID string) (string, error) {
	if err := validateKeyID(keyID); err != nil {
		return "", err
	}
	if privatePath == trustPath {
		return "", errors.New("private key and trust outputs must be different")
	}
	privateAbsolute, err := outputPathAvailable(privatePath)
	if err != nil {
		return "", err
	}
	if _, err := outputPathAvailable(trustPath); err != nil {
		return "", err
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return "", err
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	trust := trustAnchor{
		Schema:       trustSchema,
		KeyID:        keyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	}
	trustBytes, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(privatePath, privatePEM, 0o600); err != nil {
		return "", err
	}
	if err := writeExclusive(trustPath, trustBytes, 0o644); err != nil {
		_ = os.Remove(privateAbsolute)
		return "", err
	}
	digest := sha256.Sum256(public)
	return hex.EncodeToString(digest[:]), nil
}

func deriveTrust(privatePath, outputPath, keyID string) (string, error) {
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return "", err
	}
	trust, err := trustForPrivate(private, keyID)
	if err != nil {
		return "", err
	}
	payload, err := marshalJSON(trust)
	if err != nil {
		return "", err
	}
	if err := writeExclusive(outputPath, payload, 0o644); err != nil {
		return "", err
	}
	public := private.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(public)
	return hex.EncodeToString(digest[:]), nil
}

func signRelease(releasePath, privatePath, trustPath, outputPath, keyID string) (releaseDescriptor, error) {
	if err := validateKeyID(keyID); err != nil {
		return releaseDescriptor{}, err
	}
	releaseBytes, release, err := readReleaseDescriptor(releasePath)
	if err != nil {
		return releaseDescriptor{}, fmt.Errorf("release descriptor: %w", err)
	}
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return releaseDescriptor{}, err
	}
	trust, public, err := loadTrustAnchor(trustPath)
	if err != nil {
		return releaseDescriptor{}, err
	}
	if trust.KeyID != keyID {
		return releaseDescriptor{}, errors.New("key id does not match runtime component trust")
	}
	derived := private.Public().(ed25519.PublicKey)
	if !bytes.Equal(derived, public) {
		return releaseDescriptor{}, errors.New("private key does not match runtime component trust")
	}
	signed := envelope{
		Schema:    envelopeSchema,
		Payload:   releaseBytes,
		Signature: ed25519.Sign(private, releaseBytes),
		KeyID:     keyID,
	}
	payload, err := marshalJSON(signed)
	if err != nil {
		return releaseDescriptor{}, err
	}
	if err := writeExclusive(outputPath, payload, 0o644); err != nil {
		return releaseDescriptor{}, err
	}
	return release, nil
}

func verifyEnvelopeBytes(envelopeBytes, trustBytes []byte) (releaseDescriptor, error) {
	var trust trustAnchor
	if err := decodeStrict(trustBytes, maxTrustBytes, &trust); err != nil {
		return releaseDescriptor{}, fmt.Errorf("trust anchor: %w", err)
	}
	if trust.Schema != trustSchema {
		return releaseDescriptor{}, errors.New("unsupported runtime component trust schema")
	}
	if err := validateKeyID(trust.KeyID); err != nil {
		return releaseDescriptor{}, err
	}
	publicBytes, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil || len(publicBytes) != ed25519.PublicKeySize {
		return releaseDescriptor{}, errors.New("runtime component trust contains an invalid Ed25519 public key")
	}

	var signed envelope
	if err := decodeStrict(envelopeBytes, maxEnvelopeBytes, &signed); err != nil {
		return releaseDescriptor{}, fmt.Errorf("runtime component envelope: %w", err)
	}
	if signed.Schema != envelopeSchema {
		return releaseDescriptor{}, errors.New("unsupported runtime component envelope schema")
	}
	if signed.KeyID != trust.KeyID {
		return releaseDescriptor{}, errors.New("runtime component envelope key_id does not match trust")
	}
	if len(signed.Payload) == 0 || len(signed.Payload) > maxReleaseBytes {
		return releaseDescriptor{}, errors.New("runtime component signed payload size is invalid")
	}
	if len(signed.Signature) != ed25519.SignatureSize ||
		!ed25519.Verify(ed25519.PublicKey(publicBytes), signed.Payload, signed.Signature) {
		return releaseDescriptor{}, errors.New("runtime component signature verification failed")
	}
	var release releaseDescriptor
	if err := decodeStrict(signed.Payload, maxReleaseBytes, &release); err != nil {
		return releaseDescriptor{}, fmt.Errorf("signed runtime component release: %w", err)
	}
	if err := validateReleaseDescriptor(release); err != nil {
		return releaseDescriptor{}, err
	}
	return release, nil
}

func verifyEnvelopeFiles(envelopePath, trustPath string) (releaseDescriptor, []byte, []byte, error) {
	envelopeBytes, err := readRegular(envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return releaseDescriptor{}, nil, nil, err
	}
	trustBytes, err := readRegular(trustPath, maxTrustBytes, false)
	if err != nil {
		return releaseDescriptor{}, nil, nil, err
	}
	release, err := verifyEnvelopeBytes(envelopeBytes, trustBytes)
	return release, envelopeBytes, trustBytes, err
}

func safePackagePath(value string) (string, error) {
	if value == "" || strings.Contains(value, "\\") || strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("unsafe component package path: %q", value)
	}
	cleaned := pathpkg.Clean(value)
	if cleaned != value || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("unsafe component package path: %q", value)
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("unsafe component package path: %q", value)
		}
	}
	if value != packageManifestName && !strings.HasPrefix(value, "system/") {
		return "", fmt.Errorf("component package path is outside system/: %q", value)
	}
	for _, prefix := range forbiddenPackagePrefixes {
		if strings.HasPrefix(value, prefix) {
			return "", fmt.Errorf("component package crossed forbidden platform boundary: %q", value)
		}
	}
	return value, nil
}

func validatePackageManifest(manifest componentPackageManifest, release releaseDescriptor) error {
	if manifest.Schema != packageSchema || manifest.Status != "candidate" {
		return errors.New("unsupported runtime component package manifest")
	}
	if manifest.Component.ID != release.Component.ID ||
		manifest.Component.Version != release.Component.Version ||
		manifest.Component.ReleaseMode != release.Component.ReleaseMode ||
		manifest.SourceCommit != release.SourceCommit {
		return errors.New("runtime component package identity does not match signed release")
	}
	if !componentPattern.MatchString(manifest.Component.ID) || !semverPattern.MatchString(manifest.Component.Version) {
		return errors.New("runtime component package identity is invalid")
	}
	if manifest.Component.Kind == "" || manifest.Component.Title == "" ||
		manifest.Component.Owner == "" || len(manifest.Component.Dependencies) > 64 {
		return errors.New("runtime component package metadata is incomplete")
	}
	if !manifest.SelfContainedSourceGraph ||
		manifest.RemoteRuntimeDependencies ||
		manifest.ActivationAllowed ||
		!manifest.SignatureRequiredBeforeActivation ||
		manifest.NativeAdaptersPackaged ||
		manifest.CompositionPackaged {
		return errors.New("runtime component package safety policy is invalid")
	}
	entrypoint, err := safePackagePath(manifest.Entrypoint)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(entrypoint, "system/components/"+manifest.Component.ID+"/") {
		return errors.New("runtime component package entrypoint ownership is invalid")
	}
	if len(manifest.Files) == 0 || len(manifest.Files) > maxFiles {
		return errors.New("runtime component package file count is invalid")
	}
	seen := make(map[string]struct{}, len(manifest.Files))
	var total int64
	for _, record := range manifest.Files {
		path, err := safePackagePath(record.Path)
		if err != nil {
			return err
		}
		if _, exists := seen[path]; exists {
			return errors.New("runtime component package file paths must be unique")
		}
		seen[path] = struct{}{}
		if !shaPattern.MatchString(record.SHA256) ||
			record.Size <= 0 || record.Size > maxFileBytes {
			return fmt.Errorf("runtime component file binding is invalid: %s", path)
		}
		total += record.Size
		if total > maxTotalBytes {
			return errors.New("runtime component package exceeds total size limit")
		}
	}
	if _, ok := seen[entrypoint]; !ok {
		return errors.New("runtime component package entrypoint is not bound by manifest")
	}
	return nil
}

func sha256File(path string, max int64) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("package must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > max {
		return "", 0, errors.New("package size is outside allowed range")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, max+1))
	if err != nil {
		return "", 0, err
	}
	if n != info.Size() {
		return "", 0, errors.New("package size changed during verification")
	}
	return hex.EncodeToString(hash.Sum(nil)), n, nil
}

func inspectPackage(packagePath string, release releaseDescriptor) (verifiedPackage, error) {
	actualHash, actualSize, err := sha256File(packagePath, maxPackageBytes)
	if err != nil {
		return verifiedPackage{}, err
	}
	if actualHash != release.Package.SHA256 || actualSize != release.Package.Size {
		return verifiedPackage{}, errors.New("runtime component package SHA-256/size does not match signed release")
	}
	if filepath.Base(packagePath) != release.Package.Name {
		return verifiedPackage{}, errors.New("runtime component package filename does not match signed release")
	}

	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return verifiedPackage{}, err
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > maxFiles+1 {
		return verifiedPackage{}, errors.New("runtime component ZIP entry count is invalid")
	}
	entries := make(map[string]*zip.File, len(archive.File))
	for _, entry := range archive.File {
		name, err := safePackagePath(entry.Name)
		if err != nil {
			return verifiedPackage{}, err
		}
		if _, exists := entries[name]; exists {
			return verifiedPackage{}, errors.New("runtime component ZIP contains duplicate paths")
		}
		mode := entry.Mode()
		if entry.FileInfo().IsDir() || mode&os.ModeSymlink != 0 || !mode.IsRegular() {
			return verifiedPackage{}, errors.New("runtime component ZIP contains unsafe entry type")
		}
		entries[name] = entry
	}
	manifestEntry := entries[packageManifestName]
	if manifestEntry == nil {
		return verifiedPackage{}, errors.New("runtime component package manifest is missing")
	}
	if manifestEntry.UncompressedSize64 == 0 || manifestEntry.UncompressedSize64 > uint64(maxReleaseBytes) {
		return verifiedPackage{}, errors.New("runtime component package manifest size is invalid")
	}
	manifestReader, err := manifestEntry.Open()
	if err != nil {
		return verifiedPackage{}, err
	}
	manifestBytes, err := io.ReadAll(io.LimitReader(manifestReader, int64(maxReleaseBytes)+1))
	closeErr := manifestReader.Close()
	if err != nil {
		return verifiedPackage{}, err
	}
	if closeErr != nil {
		return verifiedPackage{}, closeErr
	}
	manifestDigest := sha256.Sum256(manifestBytes)
	if hex.EncodeToString(manifestDigest[:]) != release.Package.ManifestSHA256 {
		return verifiedPackage{}, errors.New("runtime component package manifest does not match signed release")
	}

	var manifest componentPackageManifest
	if err := decodeStrict(manifestBytes, maxReleaseBytes, &manifest); err != nil {
		return verifiedPackage{}, fmt.Errorf("runtime component package manifest: %w", err)
	}
	if err := validatePackageManifest(manifest, release); err != nil {
		return verifiedPackage{}, err
	}

	expected := map[string]struct{}{packageManifestName: {}}
	for _, record := range manifest.Files {
		expected[record.Path] = struct{}{}
	}
	if len(entries) != len(expected) {
		return verifiedPackage{}, errors.New("runtime component ZIP file set does not match package manifest")
	}
	for name := range entries {
		if _, ok := expected[name]; !ok {
			return verifiedPackage{}, fmt.Errorf("runtime component ZIP contains unexpected file: %s", name)
		}
	}

	files := make(map[string][]byte, len(manifest.Files))
	for _, record := range manifest.Files {
		entry := entries[record.Path]
		if entry == nil || int64(entry.UncompressedSize64) != record.Size {
			return verifiedPackage{}, fmt.Errorf("runtime component file size mismatch: %s", record.Path)
		}
		reader, err := entry.Open()
		if err != nil {
			return verifiedPackage{}, err
		}
		payload, readErr := io.ReadAll(io.LimitReader(reader, maxFileBytes+1))
		closeErr := reader.Close()
		if readErr != nil {
			return verifiedPackage{}, readErr
		}
		if closeErr != nil {
			return verifiedPackage{}, closeErr
		}
		digest := sha256.Sum256(payload)
		if int64(len(payload)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
			return verifiedPackage{}, fmt.Errorf("runtime component file integrity mismatch: %s", record.Path)
		}
		files[record.Path] = payload
	}
	return verifiedPackage{Manifest: manifest, ManifestBytes: manifestBytes, Files: files}, nil
}

func ensureSecureDirectory(path string, mode os.FileMode) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(absolute, mode); err != nil {
		return "", err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("runtime component slot path must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(absolute) {
		return "", errors.New("runtime component slot path may not traverse symlinks")
	}
	return absolute, nil
}

func writeFileSynced(path string, payload []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(payload); err != nil {
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

func materializeSlot(tempDir string, verified verifiedPackage, envelopeBytes []byte) error {
	if err := writeFileSynced(filepath.Join(tempDir, packageManifestName), verified.ManifestBytes, 0o644); err != nil {
		return err
	}
	paths := make([]string, 0, len(verified.Files))
	for name := range verified.Files {
		paths = append(paths, name)
	}
	sort.Strings(paths)
	for _, name := range paths {
		target := filepath.Join(tempDir, filepath.FromSlash(name))
		relative, err := filepath.Rel(tempDir, target)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
			return errors.New("runtime component extraction escaped staging directory")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := writeFileSynced(target, verified.Files[name], 0o644); err != nil {
			return err
		}
	}
	if err := writeFileSynced(filepath.Join(tempDir, slotEnvelopeName), envelopeBytes, 0o644); err != nil {
		return err
	}
	return nil
}

func makeSlotReadOnly(root string) error {
	directories := []string{}
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("runtime component slot contains a symlink")
		}
		if entry.IsDir() {
			directories = append(directories, path)
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("runtime component slot contains a non-regular file")
		}
		if runtime.GOOS != "windows" {
			return os.Chmod(path, 0o444)
		}
		return nil
	}); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		for i := len(directories) - 1; i >= 0; i-- {
			if err := os.Chmod(directories[i], 0o555); err != nil {
				return err
			}
		}
	}
	return nil
}

func verifySlotWithTrustBytes(slot string, trustBytes []byte) (releaseDescriptor, error) {
	absolute, err := filepath.Abs(slot)
	if err != nil {
		return releaseDescriptor{}, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return releaseDescriptor{}, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return releaseDescriptor{}, errors.New("runtime component slot is not a real directory")
	}
	envelopePath := filepath.Join(absolute, slotEnvelopeName)
	envelopeBytes, err := readRegular(envelopePath, maxEnvelopeBytes, false)
	if err != nil {
		return releaseDescriptor{}, err
	}
	release, err := verifyEnvelopeBytes(envelopeBytes, trustBytes)
	if err != nil {
		return releaseDescriptor{}, err
	}
	manifestPath := filepath.Join(absolute, packageManifestName)
	manifestBytes, err := readRegular(manifestPath, maxReleaseBytes, false)
	if err != nil {
		return releaseDescriptor{}, err
	}
	manifestDigest := sha256.Sum256(manifestBytes)
	if hex.EncodeToString(manifestDigest[:]) != release.Package.ManifestSHA256 {
		return releaseDescriptor{}, errors.New("installed runtime component manifest changed after staging")
	}
	var manifest componentPackageManifest
	if err := decodeStrict(manifestBytes, maxReleaseBytes, &manifest); err != nil {
		return releaseDescriptor{}, err
	}
	if err := validatePackageManifest(manifest, release); err != nil {
		return releaseDescriptor{}, err
	}

	expected := map[string]struct{}{
		packageManifestName: {},
		slotEnvelopeName:    {},
	}
	for _, record := range manifest.Files {
		expected[record.Path] = struct{}{}
	}

	actual := map[string]struct{}{}
	err = filepath.WalkDir(absolute, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == absolute {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("installed runtime component slot contains a symlink")
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("installed runtime component slot contains unsafe entry type")
		}
		if runtime.GOOS != "windows" && info.Mode().Perm()&0o222 != 0 {
			return fmt.Errorf("installed runtime component file is writable: %s", path)
		}
		relative, err := filepath.Rel(absolute, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		actual[name] = struct{}{}
		return nil
	})
	if err != nil {
		return releaseDescriptor{}, err
	}
	if len(actual) != len(expected) {
		return releaseDescriptor{}, errors.New("installed runtime component slot file set is not canonical")
	}
	for name := range actual {
		if _, ok := expected[name]; !ok {
			return releaseDescriptor{}, fmt.Errorf("installed runtime component slot contains unexpected file: %s", name)
		}
	}
	for _, record := range manifest.Files {
		payload, err := readRegular(filepath.Join(absolute, filepath.FromSlash(record.Path)), maxFileBytes, false)
		if err != nil {
			return releaseDescriptor{}, err
		}
		digest := sha256.Sum256(payload)
		if int64(len(payload)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
			return releaseDescriptor{}, fmt.Errorf("installed runtime component file integrity mismatch: %s", record.Path)
		}
	}
	return release, nil
}

func stageComponent(envelopePath, trustPath, packagePath, root string) (releaseDescriptor, string, bool, error) {
	release, envelopeBytes, trustBytes, err := verifyEnvelopeFiles(envelopePath, trustPath)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	verified, err := inspectPackage(packagePath, release)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	slotRoot, err := ensureSecureDirectory(root, 0o755)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	componentRoot, err := ensureSecureDirectory(filepath.Join(slotRoot, release.Component.ID), 0o755)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	versionsRoot, err := ensureSecureDirectory(filepath.Join(componentRoot, "versions"), 0o755)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	versionRoot, err := ensureSecureDirectory(filepath.Join(versionsRoot, release.Component.Version), 0o755)
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	finalDir := filepath.Join(versionRoot, release.SourceCommit)
	if info, err := os.Lstat(finalDir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return releaseDescriptor{}, "", false, errors.New("existing runtime component slot is unsafe")
		}
		existing, verifyErr := verifySlotWithTrustBytes(finalDir, trustBytes)
		if verifyErr != nil {
			return releaseDescriptor{}, "", false, fmt.Errorf("existing runtime component slot failed verification: %w", verifyErr)
		}
		if existing.SourceCommit != release.SourceCommit ||
			existing.Component.ID != release.Component.ID ||
			existing.Component.Version != release.Component.Version {
			return releaseDescriptor{}, "", false, errors.New("existing runtime component slot identity conflicts with signed release")
		}
		return release, finalDir, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return releaseDescriptor{}, "", false, err
	}

	tempDir, err := os.MkdirTemp(versionRoot, ".slot-stage-*")
	if err != nil {
		return releaseDescriptor{}, "", false, err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.RemoveAll(tempDir)
		}
	}()
	if err := materializeSlot(tempDir, verified, envelopeBytes); err != nil {
		return releaseDescriptor{}, "", false, err
	}
	if err := makeSlotReadOnly(tempDir); err != nil {
		return releaseDescriptor{}, "", false, err
	}
	if _, err := verifySlotWithTrustBytes(tempDir, trustBytes); err != nil {
		return releaseDescriptor{}, "", false, fmt.Errorf("staged runtime component verification failed: %w", err)
	}
	if err := os.Rename(tempDir, finalDir); err != nil {
		return releaseDescriptor{}, "", false, err
	}
	remove = false
	if _, err := verifySlotWithTrustBytes(finalDir, trustBytes); err != nil {
		return releaseDescriptor{}, "", false, fmt.Errorf("final runtime component slot verification failed: %w", err)
	}
	return release, finalDir, true, nil
}

func generateCommand(args []string) error {
	flags := flag.NewFlagSet("generate-key", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "new external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "new runtime component public trust path")
	keyID := flags.String("key-id", "", "runtime component trust key id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *privatePath == "" || *trustPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("generate-key requires --private-key, --trust and --key-id")
	}
	fingerprint, err := generateKey(*privatePath, *trustPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf("RUNTIME_COMPONENT_KEY_GENERATED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func deriveCommand(args []string) error {
	flags := flag.NewFlagSet("derive-trust", flag.ContinueOnError)
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	outputPath := flags.String("out", "", "new runtime component public trust path")
	keyID := flags.String("key-id", "", "runtime component trust key id")
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
	fmt.Printf("RUNTIME_COMPONENT_TRUST_DERIVED=YES\nKEY_ID=%s\nPUBLIC_KEY_SHA256=%s\nPRIVATE_KEY_PRINTED=NO\n", *keyID, fingerprint)
	return nil
}

func signCommand(args []string) error {
	flags := flag.NewFlagSet("sign", flag.ContinueOnError)
	releasePath := flags.String("release", "", "runtime component release descriptor")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "runtime component public trust")
	outputPath := flags.String("out", "", "new signed runtime component envelope")
	keyID := flags.String("key-id", "", "runtime component trust key id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *releasePath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign requires --release, --private-key, --trust, --out and --key-id")
	}
	release, err := signRelease(*releasePath, *privatePath, *trustPath, *outputPath, *keyID)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_ENVELOPE_SIGNED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nDIRECT_ACTIVATION_ALLOWED=NO\nPRIVATE_KEY_PRINTED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}

func verifyCommand(args []string) error {
	flags := flag.NewFlagSet("verify-envelope", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed runtime component envelope")
	trustPath := flags.String("trust", "", "runtime component public trust")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("verify-envelope requires --envelope and --trust")
	}
	release, _, _, err := verifyEnvelopeFiles(*envelopePath, *trustPath)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_ENVELOPE_VERIFIED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nPENDING_HEALTH_REQUIRED=YES\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}

func stageCommand(args []string) error {
	flags := flag.NewFlagSet("stage", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed runtime component envelope")
	trustPath := flags.String("trust", "", "runtime component public trust")
	packagePath := flags.String("package", "", "runtime component ZIP package")
	root := flags.String("root", defaultSlotRoot, "runtime component slot root")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *packagePath == "" || flags.NArg() != 0 {
		return errors.New("stage requires --envelope, --trust and --package")
	}
	release, slot, changed, err := stageComponent(*envelopePath, *trustPath, *packagePath, *root)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_STAGED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\nSLOT=%s\nSLOT_CHANGED=%t\nPENDING_HEALTH_REQUIRED=YES\nACTIVATED=NO\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
		slot,
		changed,
	)
	return nil
}

func verifySlotCommand(args []string) error {
	flags := flag.NewFlagSet("verify-slot", flag.ContinueOnError)
	slot := flags.String("slot", "", "installed runtime component slot")
	trustPath := flags.String("trust", "", "runtime component public trust")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *slot == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("verify-slot requires --slot and --trust")
	}
	trustBytes, err := readRegular(*trustPath, maxTrustBytes, false)
	if err != nil {
		return err
	}
	release, err := verifySlotWithTrustBytes(*slot, trustBytes)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_SLOT_VERIFIED=YES\nCOMPONENT_ID=%s\nCOMPONENT_VERSION=%s\nSOURCE_COMMIT=%s\n",
		release.Component.ID,
		release.Component.Version,
		release.SourceCommit,
	)
	return nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-runtime-component-channel <generate-key|derive-trust|sign|verify-envelope|stage|verify-slot> [options]")
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
	case "verify-envelope":
		err = verifyCommand(os.Args[2:])
	case "stage":
		err = stageCommand(os.Args[2:])
	case "verify-slot":
		err = verifySlotCommand(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-runtime-component-channel: ERROR:", err)
		os.Exit(1)
	}
}
