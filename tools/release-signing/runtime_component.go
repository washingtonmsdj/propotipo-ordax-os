package main

import (
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	runtimeComponentEnvelopeSchema = "prototype-ordax.runtime-component-envelope/1"
	runtimeComponentManifestSchema = "prototype-ordax.runtime-component-release-manifest/1"
	runtimeComponentPurpose        = "ordax-runtime-component"
	runtimeComponentRecipe         = "runtime/component/package/1"
	maxRuntimeComponentPackage     = int64(32 << 20)
)

var (
	componentIDPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
	componentVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`)
)

type RuntimeComponentPackage struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type RuntimeComponentManifest struct {
	Schema            string                  `json:"$schema"`
	Purpose           string                  `json:"purpose"`
	SourceRepository  string                  `json:"source_repository"`
	SourceCommit      string                  `json:"source_commit"`
	ComponentID       string                  `json:"component_id"`
	Version           string                  `json:"version"`
	ReleaseSequence   int64                   `json:"release_sequence"`
	CreatedFromRecipe string                  `json:"created_from_recipe"`
	Package           RuntimeComponentPackage `json:"package"`
}

func strictRuntimeComponentManifest(data []byte, expectedRepository string) (RuntimeComponentManifest, error) {
	var manifest RuntimeComponentManifest
	if err := decodeStrict(data, maxManifest, &manifest); err != nil {
		return RuntimeComponentManifest{}, fmt.Errorf("decode runtime component manifest: %w", err)
	}
	if manifest.Schema != runtimeComponentManifestSchema {
		return RuntimeComponentManifest{}, errors.New("unsupported runtime component manifest schema")
	}
	if manifest.Purpose != runtimeComponentPurpose {
		return RuntimeComponentManifest{}, errors.New("runtime component manifest purpose is invalid")
	}
	if manifest.SourceRepository != expectedRepository {
		return RuntimeComponentManifest{}, fmt.Errorf("unexpected source repository: %q", manifest.SourceRepository)
	}
	if !commitPattern.MatchString(manifest.SourceCommit) {
		return RuntimeComponentManifest{}, errors.New("source_commit must be lowercase 40-hex")
	}
	if !componentIDPattern.MatchString(manifest.ComponentID) {
		return RuntimeComponentManifest{}, errors.New("runtime component id is invalid")
	}
	if !componentVersionPattern.MatchString(manifest.Version) {
		return RuntimeComponentManifest{}, errors.New("runtime component version is invalid")
	}
	if manifest.ReleaseSequence <= 0 {
		return RuntimeComponentManifest{}, errors.New("runtime component release_sequence must be positive")
	}
	if manifest.CreatedFromRecipe != runtimeComponentRecipe {
		return RuntimeComponentManifest{}, errors.New("runtime component recipe is invalid")
	}
	expectedName := manifest.ComponentID + ".zip"
	if manifest.Package.Name != expectedName || filepath.Base(manifest.Package.Name) != manifest.Package.Name || strings.ContainsAny(manifest.Package.Name, `/\`) {
		return RuntimeComponentManifest{}, fmt.Errorf("runtime component package name must be %q", expectedName)
	}
	if !shaPattern.MatchString(manifest.Package.SHA256) {
		return RuntimeComponentManifest{}, errors.New("runtime component package SHA-256 is invalid")
	}
	if manifest.Package.Size <= 0 || manifest.Package.Size > maxRuntimeComponentPackage {
		return RuntimeComponentManifest{}, errors.New("runtime component package size is outside allowed range")
	}
	parsed, err := url.Parse(manifest.Package.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return RuntimeComponentManifest{}, errors.New("runtime component package URL must be absolute HTTPS without credentials or fragment")
	}
	if filepath.Base(parsed.Path) != expectedName {
		return RuntimeComponentManifest{}, fmt.Errorf("runtime component package URL must end with %q", expectedName)
	}
	return manifest, nil
}

func signRuntimeComponentManifest(manifestPath, privatePath, trustPath, outputPath, keyID, repository string) (RuntimeComponentManifest, error) {
	if err := validateKeyID(keyID); err != nil {
		return RuntimeComponentManifest{}, err
	}
	manifestBytes, err := readRegular(manifestPath, maxManifest, false)
	if err != nil {
		return RuntimeComponentManifest{}, fmt.Errorf("manifest: %w", err)
	}
	manifest, err := strictRuntimeComponentManifest(manifestBytes, repository)
	if err != nil {
		return RuntimeComponentManifest{}, err
	}
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return RuntimeComponentManifest{}, err
	}
	trust, trustedPublic, err := loadTrustAnchor(trustPath)
	if err != nil {
		return RuntimeComponentManifest{}, err
	}
	if err := validateSigningIdentity(privateKey, trust, trustedPublic, keyID); err != nil {
		return RuntimeComponentManifest{}, err
	}
	signature := ed25519.Sign(privateKey, manifestBytes)
	envelope := Envelope{
		Schema:    runtimeComponentEnvelopeSchema,
		Payload:   manifestBytes,
		Signature: signature,
		KeyID:     keyID,
	}
	envelopeBytes, err := marshalJSON(envelope)
	if err != nil {
		return RuntimeComponentManifest{}, err
	}
	if err := writeExclusive(outputPath, envelopeBytes, 0o644); err != nil {
		return RuntimeComponentManifest{}, err
	}
	return manifest, nil
}

func verifyRuntimeComponentEnvelope(envelopePath, trustPath, repository string) (RuntimeComponentManifest, error) {
	envelopeBytes, err := readRegular(envelopePath, maxEnvelope, false)
	if err != nil {
		return RuntimeComponentManifest{}, fmt.Errorf("envelope: %w", err)
	}
	var envelope Envelope
	if err := decodeStrict(envelopeBytes, maxEnvelope, &envelope); err != nil {
		return RuntimeComponentManifest{}, fmt.Errorf("envelope: %w", err)
	}
	if envelope.Schema != runtimeComponentEnvelopeSchema {
		return RuntimeComponentManifest{}, errors.New("unsupported runtime component envelope schema")
	}
	if err := validateKeyID(envelope.KeyID); err != nil {
		return RuntimeComponentManifest{}, fmt.Errorf("envelope: %w", err)
	}
	trust, publicKey, err := loadTrustAnchor(trustPath)
	if err != nil {
		return RuntimeComponentManifest{}, err
	}
	if envelope.KeyID != trust.KeyID {
		return RuntimeComponentManifest{}, errors.New("runtime component envelope key id does not match trust anchor")
	}
	if len(envelope.Signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, envelope.Payload, envelope.Signature) {
		return RuntimeComponentManifest{}, errors.New("runtime component envelope signature verification failed")
	}
	return strictRuntimeComponentManifest(envelope.Payload, repository)
}

func signRuntimeComponentCommand(args []string) error {
	flags := flag.NewFlagSet("sign-runtime-component", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "exact runtime component release manifest JSON path")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON expected by devices")
	outputPath := flags.String("out", "", "new runtime component envelope JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *privatePath == "" || *trustPath == "" || *outputPath == "" || *keyID == "" || flags.NArg() != 0 {
		return errors.New("sign-runtime-component requires --manifest, --private-key, --trust, --out and --key-id")
	}
	manifest, err := signRuntimeComponentManifest(
		*manifestPath,
		*privatePath,
		*trustPath,
		*outputPath,
		*keyID,
		*repository,
	)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_ENVELOPE_SIGNED=YES\nCOMPONENT_ID=%s\nVERSION=%s\nRELEASE_SEQUENCE=%d\nSOURCE_COMMIT=%s\nKEY_ID=%s\nTRUST_MATCH=YES\nPRIVATE_KEY_PRINTED=NO\n",
		manifest.ComponentID,
		manifest.Version,
		manifest.ReleaseSequence,
		manifest.SourceCommit,
		*keyID,
	)
	return nil
}

func verifyRuntimeComponentCommand(args []string) error {
	flags := flag.NewFlagSet("verify-runtime-component-envelope", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "signed runtime component envelope JSON path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON path")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || flags.NArg() != 0 {
		return errors.New("verify-runtime-component-envelope requires --envelope and --trust")
	}
	manifest, err := verifyRuntimeComponentEnvelope(*envelopePath, *trustPath, *repository)
	if err != nil {
		return err
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_ENVELOPE_VERIFIED=YES\nCOMPONENT_ID=%s\nVERSION=%s\nRELEASE_SEQUENCE=%d\nSOURCE_COMMIT=%s\nSIGNATURE_VERIFIED=YES\n",
		manifest.ComponentID,
		manifest.Version,
		manifest.ReleaseSequence,
		manifest.SourceCommit,
	)
	return nil
}
