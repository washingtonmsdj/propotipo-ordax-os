package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	pathpkg "path"
	"regexp"
	"strings"
)

const (
	componentEnvelopeSchema = "prototype-ordax.runtime-component-envelope/1"
	componentReleaseSchema  = "prototype-ordax.runtime-component-release/1"
	componentPackageSchema  = "prototype-ordax.runtime-component-package/1"
	componentStageSchema    = "prototype-ordax.runtime-component-stage/1"

	maxComponentPackage = int64(16 << 20)
	maxComponentFiles   = 256
	maxComponentFile    = int64(2 << 20)
)

var (
	componentIDPattern      = regexp.MustCompile("^[a-z][a-z0-9-]{0,63}$")
	componentVersionPattern = regexp.MustCompile("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
)

type ComponentPackageBinding struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type ComponentReleaseManifest struct {
	Schema              string                  `json:"$schema"`
	SourceRepository    string                  `json:"source_repository"`
	SourceCommit        string                  `json:"source_commit"`
	ComponentID         string                  `json:"component_id"`
	Version             string                  `json:"version"`
	ReleaseSequence     int64                   `json:"release_sequence"`
	CreatedFromCIRecipe string                  `json:"created_from_ci_recipe"`
	Package             ComponentPackageBinding `json:"package"`
}

type ComponentPackageIdentity struct {
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

type ComponentPackageFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type ComponentPackageManifest struct {
	Schema                            string                   `json:"$schema"`
	Status                            string                   `json:"status"`
	Component                         ComponentPackageIdentity `json:"component"`
	SourceCommit                      string                   `json:"source_commit"`
	Entrypoint                        string                   `json:"entrypoint"`
	SelfContainedSourceGraph          bool                     `json:"self_contained_source_graph"`
	RemoteRuntimeDependencies         bool                     `json:"remote_runtime_dependencies"`
	ActivationAllowed                 bool                     `json:"activation_allowed"`
	SignatureRequiredBeforeActivation bool                     `json:"signature_required_before_activation"`
	NativeAdaptersPackaged            bool                     `json:"native_adapters_packaged"`
	CompositionPackaged               bool                     `json:"composition_packaged"`
	Files                             []ComponentPackageFile   `json:"files"`
}

type ComponentStageReceipt struct {
	Schema            string `json:"$schema"`
	Status            string `json:"status"`
	ComponentID       string `json:"component_id"`
	Version           string `json:"version"`
	SourceCommit      string `json:"source_commit"`
	ReleaseSequence   int64  `json:"release_sequence"`
	StagePath         string `json:"stage_path"`
	Idempotent        bool   `json:"idempotent"`
	ActivationAllowed bool   `json:"activation_allowed"`
}

func validateComponentReleaseManifest(m ComponentReleaseManifest, expectedRepo, expectedComponent string) error {
	if m.Schema != componentReleaseSchema {
		return errors.New("unsupported runtime component release schema")
	}
	if m.SourceRepository != expectedRepo {
		return fmt.Errorf("unexpected component source repository: %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("component source_commit must be lowercase 40-hex")
	}
	if !componentIDPattern.MatchString(m.ComponentID) {
		return errors.New("runtime component id is invalid")
	}
	if expectedComponent != "" && m.ComponentID != expectedComponent {
		return fmt.Errorf("signed runtime component id mismatch: got=%s expected=%s", m.ComponentID, expectedComponent)
	}
	if !componentVersionPattern.MatchString(m.Version) {
		return errors.New("runtime component version must be semantic version x.y.z")
	}
	if m.ReleaseSequence <= 0 {
		return errors.New("runtime component release_sequence must be positive")
	}
	if !recipePattern.MatchString(m.CreatedFromCIRecipe) {
		return errors.New("runtime component created_from_ci_recipe is invalid")
	}
	if m.Package.Name != m.ComponentID+".zip" {
		return errors.New("runtime component package name must match component id")
	}
	if !shaPattern.MatchString(m.Package.SHA256) {
		return errors.New("runtime component package SHA-256 is invalid")
	}
	if m.Package.Size <= 0 || m.Package.Size > maxComponentPackage {
		return errors.New("runtime component package size is outside allowed range")
	}
	if err := validateHTTPSURL(m.Package.URL); err != nil {
		return fmt.Errorf("runtime component package URL: %w", err)
	}
	return nil
}

func verifyComponentEnvelope(data []byte, trust TrustAnchor, key ed25519.PublicKey, expectedRepo, expectedComponent string) (ComponentReleaseManifest, []byte, error) {
	var envelope Envelope
	if err := strictDecode(data, maxEnvelope, &envelope); err != nil {
		return ComponentReleaseManifest{}, nil, fmt.Errorf("invalid runtime component envelope: %w", err)
	}
	if envelope.Schema != componentEnvelopeSchema {
		return ComponentReleaseManifest{}, nil, errors.New("unsupported runtime component envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return ComponentReleaseManifest{}, nil, errors.New("runtime component key id does not match trust anchor")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxPayload {
		return ComponentReleaseManifest{}, nil, errors.New("runtime component signed payload is outside allowed size")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return ComponentReleaseManifest{}, nil, errors.New("runtime component signature verification failed")
	}
	var manifest ComponentReleaseManifest
	if err := strictDecode(envelope.Payload, maxPayload, &manifest); err != nil {
		return ComponentReleaseManifest{}, nil, fmt.Errorf("invalid signed runtime component manifest: %w", err)
	}
	if err := validateComponentReleaseManifest(manifest, expectedRepo, expectedComponent); err != nil {
		return ComponentReleaseManifest{}, nil, err
	}
	return manifest, envelope.Payload, nil
}

func safeComponentPackagePath(value string) (string, error) {
	if value == "" || strings.HasPrefix(value, "/") || strings.Contains(value, "\\") {
		return "", fmt.Errorf("unsafe runtime component package path: %q", value)
	}
	cleaned := pathpkg.Clean(value)
	if cleaned != value || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("unsafe runtime component package path: %q", value)
	}
	if cleaned != "component-package.json" && cleaned != "system" && !strings.HasPrefix(cleaned, "system/") {
		return "", fmt.Errorf("runtime component package path escapes allowed roots: %q", value)
	}
	return cleaned, nil
}

func validateComponentPackageManifest(m ComponentPackageManifest, release ComponentReleaseManifest) error {
	if m.Schema != componentPackageSchema || m.Status != "candidate" {
		return errors.New("unsupported runtime component package manifest")
	}
	if m.SourceCommit != release.SourceCommit {
		return errors.New("runtime component package source_commit differs from signed release")
	}
	if m.Component.ID != release.ComponentID || m.Component.Version != release.Version {
		return errors.New("runtime component package identity differs from signed release")
	}
	if !componentIDPattern.MatchString(m.Component.ID) || !componentVersionPattern.MatchString(m.Component.Version) {
		return errors.New("runtime component package identity is invalid")
	}
	if m.Component.ReleaseMode != "bundled" && m.Component.ReleaseMode != "component-slot" {
		return errors.New("runtime component package releaseMode is invalid")
	}
	if !m.SelfContainedSourceGraph || m.RemoteRuntimeDependencies || m.ActivationAllowed || !m.SignatureRequiredBeforeActivation || m.NativeAdaptersPackaged || m.CompositionPackaged {
		return errors.New("runtime component package safety policy is invalid")
	}
	entrypoint, err := safeComponentPackagePath(m.Entrypoint)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(entrypoint, "system/components/"+m.Component.ID+"/") {
		return errors.New("runtime component package entrypoint is outside component ownership")
	}
	if len(m.Files) == 0 || len(m.Files) > maxComponentFiles {
		return errors.New("runtime component package file count is outside allowed range")
	}
	seen := map[string]bool{}
	entrypointSeen := false
	var total int64
	for _, record := range m.Files {
		p, err := safeComponentPackagePath(record.Path)
		if err != nil {
			return err
		}
		if p == "component-package.json" {
			return errors.New("runtime component package manifest may not bind itself")
		}
		if seen[p] {
			return fmt.Errorf("duplicate runtime component package file: %s", p)
		}
		seen[p] = true
		if p == entrypoint {
			entrypointSeen = true
		}
		if !shaPattern.MatchString(record.SHA256) {
			return fmt.Errorf("runtime component package file hash is invalid: %s", p)
		}
		if record.Size <= 0 || record.Size > maxComponentFile {
			return fmt.Errorf("runtime component package file size is invalid: %s", p)
		}
		total += record.Size
		if total > maxComponentPackage {
			return errors.New("runtime component package expanded size exceeds allowed range")
		}
	}
	if !entrypointSeen {
		return errors.New("runtime component package entrypoint is not bound by manifest")
	}
	return nil
}

func readZipFileBounded(item *zip.File, limit int64) ([]byte, error) {
	if int64(item.UncompressedSize64) > limit {
		return nil, fmt.Errorf("runtime component archive entry exceeds limit: %s", item.Name)
	}
	reader, err := item.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	payload, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, fmt.Errorf("runtime component archive entry exceeds limit: %s", item.Name)
	}
	return payload, nil
}

func componentPackageFiles(packageBytes []byte, release ComponentReleaseManifest) (ComponentPackageManifest, map[string]*zip.File, error) {
	reader, err := zip.NewReader(bytes.NewReader(packageBytes), int64(len(packageBytes)))
	if err != nil {
		return ComponentPackageManifest{}, nil, fmt.Errorf("open runtime component package: %w", err)
	}
	if len(reader.File) < 2 || len(reader.File) > maxComponentFiles+1 {
		return ComponentPackageManifest{}, nil, errors.New("runtime component package archive entry count is invalid")
	}
	files := map[string]*zip.File{}
	for _, item := range reader.File {
		name, err := safeComponentPackagePath(item.Name)
		if err != nil {
			return ComponentPackageManifest{}, nil, err
		}
		if files[name] != nil {
			return ComponentPackageManifest{}, nil, fmt.Errorf("duplicate runtime component archive entry: %s", name)
		}
		mode := item.Mode()
		if item.FileInfo().IsDir() || mode&os.ModeSymlink != 0 || !mode.IsRegular() {
			return ComponentPackageManifest{}, nil, fmt.Errorf("runtime component archive entry is not a regular file: %s", name)
		}
		if item.UncompressedSize64 == 0 || item.UncompressedSize64 > uint64(maxComponentFile) {
			return ComponentPackageManifest{}, nil, fmt.Errorf("runtime component archive entry size is invalid: %s", name)
		}
		files[name] = item
	}
	manifestFile := files["component-package.json"]
	if manifestFile == nil {
		return ComponentPackageManifest{}, nil, errors.New("runtime component package manifest is missing")
	}
	manifestBytes, err := readZipFileBounded(manifestFile, 1<<20)
	if err != nil {
		return ComponentPackageManifest{}, nil, err
	}
	var manifest ComponentPackageManifest
	if err := strictDecode(manifestBytes, 1<<20, &manifest); err != nil {
		return ComponentPackageManifest{}, nil, fmt.Errorf("decode runtime component package manifest: %w", err)
	}
	if err := validateComponentPackageManifest(manifest, release); err != nil {
		return ComponentPackageManifest{}, nil, err
	}
	if len(files) != len(manifest.Files)+1 {
		return ComponentPackageManifest{}, nil, errors.New("runtime component archive file set differs from manifest")
	}
	for _, record := range manifest.Files {
		item := files[record.Path]
		if item == nil {
			return ComponentPackageManifest{}, nil, fmt.Errorf("runtime component package file is missing: %s", record.Path)
		}
		payload, err := readZipFileBounded(item, maxComponentFile)
		if err != nil {
			return ComponentPackageManifest{}, nil, err
		}
		digest := sha256.Sum256(payload)
		if int64(len(payload)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
			return ComponentPackageManifest{}, nil, fmt.Errorf("runtime component package integrity mismatch: %s", record.Path)
		}
	}
	return manifest, files, nil
}

func verifyComponentPackageBytes(packageBytes []byte, release ComponentReleaseManifest) (ComponentPackageManifest, error) {
	if int64(len(packageBytes)) != release.Package.Size {
		return ComponentPackageManifest{}, errors.New("runtime component package size differs from signed release")
	}
	digest := sha256.Sum256(packageBytes)
	if hex.EncodeToString(digest[:]) != release.Package.SHA256 {
		return ComponentPackageManifest{}, errors.New("runtime component package SHA-256 differs from signed release")
	}
	manifest, _, err := componentPackageFiles(packageBytes, release)
	return manifest, err
}
