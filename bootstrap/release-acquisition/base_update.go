package main

import (
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"os"
)

const (
	baseUpdateEnvelopeSchema     = "prototype-ordax.base-update-envelope/1"
	baseUpdateManifestSchema     = "prototype-ordax.base-update-manifest/1"
	baseUpdateVerificationSchema = "prototype-ordax.base-update-verification/1"
)

type BaseUpdateManifest struct {
	Schema              string               `json:"$schema"`
	SourceRepository    string               `json:"source_repository"`
	ReleaseSHA          string               `json:"release_sha"`
	CreatedFromCIRecipe string               `json:"created_from_ci_recipe"`
	Artifacts           []BaseUpdateArtifact `json:"artifacts"`
}

type BaseUpdateArtifact struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type BaseUpdateVerification struct {
	Schema             string `json:"$schema"`
	Status             string `json:"status"`
	SourceRepository   string `json:"source_repository"`
	ReleaseSHA         string `json:"release_sha"`
	KeyID              string `json:"key_id"`
	KernelSHA256       string `json:"kernel_sha256"`
	KernelSize         int64  `json:"kernel_size"`
	InitramfsSHA256    string `json:"initramfs_sha256"`
	InitramfsSize      int64  `json:"initramfs_size"`
}

func validateBaseUpdateManifest(m BaseUpdateManifest, expectedRepo string) error {
	if m.Schema != baseUpdateManifestSchema {
		return errors.New("unsupported base update manifest schema")
	}
	if m.SourceRepository != expectedRepo {
		return fmt.Errorf("unexpected source repository: %q", m.SourceRepository)
	}
	if !commitPattern.MatchString(m.ReleaseSHA) {
		return errors.New("release_sha must be lowercase 40-hex")
	}
	if !recipePattern.MatchString(m.CreatedFromCIRecipe) {
		return errors.New("invalid created_from_ci_recipe")
	}
	if len(m.Artifacts) != 2 {
		return errors.New("base-update-manifest/1 requires exactly kernel and initramfs artifacts")
	}
	expected := []struct {
		name string
		role string
	}{
		{"vmlinuz", "kernel"},
		{"initrd.gz", "initramfs"},
	}
	for index, artifact := range m.Artifacts {
		if artifact.Name != expected[index].name || artifact.Role != expected[index].role {
			return fmt.Errorf(
				"base update artifact %d must be %s with role=%s",
				index,
				expected[index].name,
				expected[index].role,
			)
		}
		if !shaPattern.MatchString(artifact.SHA256) {
			return fmt.Errorf("invalid artifact SHA-256 for %q", artifact.Name)
		}
		if artifact.Size <= 0 || artifact.Size > maxArtifact {
			return fmt.Errorf("artifact size outside allowed range for %q", artifact.Name)
		}
	}
	return nil
}

func verifyBaseUpdateEnvelope(
	data []byte,
	trust TrustAnchor,
	key ed25519.PublicKey,
	expectedRepo string,
) (BaseUpdateManifest, error) {
	var envelope Envelope
	if err := strictDecode(data, maxEnvelope, &envelope); err != nil {
		return BaseUpdateManifest{}, fmt.Errorf("invalid base update envelope: %w", err)
	}
	if envelope.Schema != baseUpdateEnvelopeSchema {
		return BaseUpdateManifest{}, errors.New("unsupported base update envelope schema")
	}
	if envelope.KeyID != trust.KeyID {
		return BaseUpdateManifest{}, errors.New("base update key id does not match trust anchor")
	}
	if len(envelope.Payload) == 0 || len(envelope.Payload) > maxPayload {
		return BaseUpdateManifest{}, errors.New("signed base update manifest payload is outside allowed size")
	}
	if len(envelope.Signature) != ed25519.SignatureSize ||
		!ed25519.Verify(key, envelope.Payload, envelope.Signature) {
		return BaseUpdateManifest{}, errors.New("base update manifest signature verification failed")
	}
	var manifest BaseUpdateManifest
	if err := strictDecode(envelope.Payload, maxPayload, &manifest); err != nil {
		return BaseUpdateManifest{}, fmt.Errorf("invalid signed base update manifest: %w", err)
	}
	if err := validateBaseUpdateManifest(manifest, expectedRepo); err != nil {
		return BaseUpdateManifest{}, err
	}
	return manifest, nil
}

func baseUpdateVerification(manifest BaseUpdateManifest, trust TrustAnchor) BaseUpdateVerification {
	return BaseUpdateVerification{
		Schema:           baseUpdateVerificationSchema,
		Status:           "verified",
		SourceRepository: manifest.SourceRepository,
		ReleaseSHA:       manifest.ReleaseSHA,
		KeyID:            trust.KeyID,
		KernelSHA256:     manifest.Artifacts[0].SHA256,
		KernelSize:       manifest.Artifacts[0].Size,
		InitramfsSHA256:  manifest.Artifacts[1].SHA256,
		InitramfsSize:    manifest.Artifacts[1].Size,
	}
}

func verifyBaseUpdateCommand(args []string) error {
	fs := flag.NewFlagSet("verify-base-update-envelope", flag.ContinueOnError)
	envelopePath := fs.String("envelope", "", "signed base update envelope file")
	trustPath := fs.String("trust", "", "release trust anchor file")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || fs.NArg() != 0 {
		return errors.New("verify-base-update-envelope requires --envelope and --trust")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*envelopePath)
	if err != nil {
		return err
	}
	manifest, err := verifyBaseUpdateEnvelope(data, trust, key, *repository)
	if err != nil {
		return err
	}
	return printJSON(baseUpdateVerification(manifest, trust))
}

