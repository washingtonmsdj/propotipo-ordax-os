package main

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
)

const (
	componentEnvelopeSchema = "prototype-ordax.runtime-component-envelope/1"
	componentReleaseSchema  = "prototype-ordax.runtime-component-release/1"
	maxComponentPackage     = int64(16 << 20)
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

func validateComponentReleaseManifest(m ComponentReleaseManifest, expectedRepository, expectedComponent string) error {
	if m.Schema != componentReleaseSchema {
		return errors.New("unsupported runtime component release schema")
	}
	if m.SourceRepository != expectedRepository {
		return fmt.Errorf("unexpected component source repository: %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return errors.New("component source_commit must be lowercase 40-hex")
	}
	if !componentIDPattern.MatchString(m.ComponentID) {
		return errors.New("runtime component id is invalid")
	}
	if expectedComponent != "" && m.ComponentID != expectedComponent {
		return fmt.Errorf("runtime component id mismatch: got=%s expected=%s", m.ComponentID, expectedComponent)
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

func strictComponentManifest(data []byte, expectedRepository, expectedComponent string) (ComponentReleaseManifest, error) {
	var manifest ComponentReleaseManifest
	if err := decodeStrict(data, maxManifest, &manifest); err != nil {
		return ComponentReleaseManifest{}, fmt.Errorf("decode runtime component manifest: %w", err)
	}
	if err := validateComponentReleaseManifest(manifest, expectedRepository, expectedComponent); err != nil {
		return ComponentReleaseManifest{}, err
	}
	return manifest, nil
}

func signComponentManifest(
	manifestPath,
	privatePath,
	trustPath,
	outputPath,
	keyID,
	expectedRepository,
	expectedComponent string,
) (ComponentReleaseManifest, error) {
	manifestBytes, err := readRegular(manifestPath, maxManifest, false)
	if err != nil {
		return ComponentReleaseManifest{}, fmt.Errorf("runtime component manifest: %w", err)
	}
	manifest, err := strictComponentManifest(manifestBytes, expectedRepository, expectedComponent)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	privateKey, err := loadPrivateKey(privatePath)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	trust, publicKey, err := loadTrustAnchor(trustPath)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	if err := validateSigningIdentity(privateKey, trust, publicKey, keyID); err != nil {
		return ComponentReleaseManifest{}, err
	}
	envelope := Envelope{
		Schema:    componentEnvelopeSchema,
		Payload:   manifestBytes,
		Signature: ed25519.Sign(privateKey, manifestBytes),
		KeyID:     keyID,
	}
	data, err := marshalJSON(envelope)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	if err := writeExclusive(outputPath, data, 0o644); err != nil {
		return ComponentReleaseManifest{}, err
	}
	return manifest, nil
}

func verifyComponentEnvelopeFile(
	envelopePath,
	trustPath,
	expectedRepository,
	expectedComponent string,
) (ComponentReleaseManifest, error) {
	envelopeBytes, err := readRegular(envelopePath, maxEnvelope, false)
	if err != nil {
		return ComponentReleaseManifest{}, fmt.Errorf("runtime component envelope: %w", err)
	}
	var envelope Envelope
	if err := decodeStrict(envelopeBytes, maxEnvelope, &envelope); err != nil {
		return ComponentReleaseManifest{}, fmt.Errorf("runtime component envelope: %w", err)
	}
	if envelope.Schema != componentEnvelopeSchema {
		return ComponentReleaseManifest{}, errors.New("unsupported runtime component envelope schema")
	}
	trust, publicKey, err := loadTrustAnchor(trustPath)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	if envelope.KeyID != trust.KeyID {
		return ComponentReleaseManifest{}, errors.New("runtime component key id does not match trust anchor")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxManifest {
		return ComponentReleaseManifest{}, errors.New("runtime component signed payload size is invalid")
	}
	if len(envelope.Signature) != ed25519.SignatureSize ||
		!ed25519.Verify(publicKey, envelope.Payload, envelope.Signature) {
		return ComponentReleaseManifest{}, errors.New("runtime component signature verification failed")
	}
	return strictComponentManifest(envelope.Payload, expectedRepository, expectedComponent)
}

func signComponentCommand(args []string) error {
	flags := flag.NewFlagSet("sign-component", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "exact runtime component manifest JSON path")
	privatePath := flags.String("private-key", "", "external PKCS#8 Ed25519 private-key path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON expected by devices")
	outputPath := flags.String("out", "", "new runtime component envelope JSON path")
	keyID := flags.String("key-id", "", "stable release key identifier")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	componentID := flags.String("component", "", "expected runtime component id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *privatePath == "" || *trustPath == "" ||
		*outputPath == "" || *keyID == "" || *componentID == "" || flags.NArg() != 0 {
		return errors.New("sign-component requires --manifest, --private-key, --trust, --out, --key-id and --component")
	}
	manifest, err := signComponentManifest(
		*manifestPath,
		*privatePath,
		*trustPath,
		*outputPath,
		*keyID,
		*repository,
		*componentID,
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

func verifyComponentSigningCommand(args []string) error {
	flags := flag.NewFlagSet("verify-component-envelope", flag.ContinueOnError)
	envelopePath := flags.String("envelope", "", "runtime component envelope JSON path")
	trustPath := flags.String("trust", "", "public trust-anchor JSON")
	repository := flags.String("repository", defaultRepo, "expected source repository")
	componentID := flags.String("component", "", "expected runtime component id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *componentID == "" || flags.NArg() != 0 {
		return errors.New("verify-component-envelope requires --envelope, --trust and --component")
	}
	manifest, err := verifyComponentEnvelopeFile(
		*envelopePath,
		*trustPath,
		*repository,
		*componentID,
	)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(manifest)
	if err != nil || len(encoded) == 0 {
		return errors.New("could not encode verified runtime component identity")
	}
	fmt.Printf(
		"RUNTIME_COMPONENT_ENVELOPE_VERIFIED=YES\nCOMPONENT_ID=%s\nVERSION=%s\nRELEASE_SEQUENCE=%d\nSOURCE_COMMIT=%s\n",
		manifest.ComponentID,
		manifest.Version,
		manifest.ReleaseSequence,
		manifest.SourceCommit,
	)
	return nil
}

func readComponentEnvelopeForTest(path string) ([]byte, error) {
	return os.ReadFile(path)
}
