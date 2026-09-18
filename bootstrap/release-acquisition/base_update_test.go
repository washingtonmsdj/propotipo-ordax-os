package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func baseUpdateTestMaterial(t *testing.T) (TrustAnchor, ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{
		Schema:       trustSchema,
		KeyID:        "ordax-prototype-release-v1",
		PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey),
	}
	return trust, publicKey, privateKey
}

func validBaseUpdateManifest() BaseUpdateManifest {
	return BaseUpdateManifest{
		Schema:              baseUpdateManifestSchema,
		SourceRepository:    defaultRepo,
		ReleaseSHA:          "0123456789abcdef0123456789abcdef01234567",
		CreatedFromCIRecipe: "base-update/kernel-initramfs/1",
		Artifacts: []BaseUpdateArtifact{
			{Name: "vmlinuz", Role: "kernel", SHA256: "a" + string(make([]byte, 0)), Size: 1},
			{Name: "initrd.gz", Role: "initramfs", SHA256: "b" + string(make([]byte, 0)), Size: 1},
		},
	}
}

func canonicalBaseUpdateManifest() BaseUpdateManifest {
	m := validBaseUpdateManifest()
	m.Artifacts[0].SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	m.Artifacts[1].SHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	return m
}

func signedBaseUpdateEnvelope(t *testing.T, manifest BaseUpdateManifest, keyID string, privateKey ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		Schema:    baseUpdateEnvelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(privateKey, payload),
		KeyID:     keyID,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestVerifyBaseUpdateEnvelopeAcceptsCanonicalSignedCandidate(t *testing.T) {
	trust, publicKey, privateKey := baseUpdateTestMaterial(t)
	manifest, err := verifyBaseUpdateEnvelope(
		signedBaseUpdateEnvelope(t, canonicalBaseUpdateManifest(), trust.KeyID, privateKey),
		trust,
		publicKey,
		defaultRepo,
	)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ReleaseSHA != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("unexpected release sha: %s", manifest.ReleaseSHA)
	}
	verified := baseUpdateVerification(manifest, trust)
	if verified.Status != "verified" || verified.KernelSize != 1 || verified.InitramfsSize != 1 {
		t.Fatalf("unexpected verification output: %#v", verified)
	}
}

func TestVerifyBaseUpdateEnvelopeRejectsTampering(t *testing.T) {
	trust, publicKey, privateKey := baseUpdateTestMaterial(t)
	data := signedBaseUpdateEnvelope(t, canonicalBaseUpdateManifest(), trust.KeyID, privateKey)
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload[0] ^= 1
	tampered, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyBaseUpdateEnvelope(tampered, trust, publicKey, defaultRepo); err == nil {
		t.Fatal("tampered base update envelope was accepted")
	}
}

func TestVerifyBaseUpdateEnvelopeRejectsWrongKeyIDAndArtifactShape(t *testing.T) {
	trust, publicKey, privateKey := baseUpdateTestMaterial(t)
	if _, err := verifyBaseUpdateEnvelope(
		signedBaseUpdateEnvelope(t, canonicalBaseUpdateManifest(), "other-key", privateKey),
		trust,
		publicKey,
		defaultRepo,
	); err == nil {
		t.Fatal("mismatched key id was accepted")
	}

	manifest := canonicalBaseUpdateManifest()
	manifest.Artifacts = manifest.Artifacts[:1]
	if _, err := verifyBaseUpdateEnvelope(
		signedBaseUpdateEnvelope(t, manifest, trust.KeyID, privateKey),
		trust,
		publicKey,
		defaultRepo,
	); err == nil {
		t.Fatal("incomplete base update manifest was accepted")
	}
}

func TestVerifyBaseUpdateEnvelopeRejectsUnexpectedManifestFields(t *testing.T) {
	trust, publicKey, privateKey := baseUpdateTestMaterial(t)
	payload := []byte(`{"$schema":"prototype-ordax.base-update-manifest/1","source_repository":"washingtonmsdj/prototipo-ordax-os","release_sha":"0123456789abcdef0123456789abcdef01234567","created_from_ci_recipe":"base-update/kernel-initramfs/1","artifacts":[{"name":"vmlinuz","role":"kernel","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1},{"name":"initrd.gz","role":"initramfs","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","size":1}],"unexpected":true}`)
	envelope := Envelope{
		Schema:    baseUpdateEnvelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(privateKey, payload),
		KeyID:     trust.KeyID,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyBaseUpdateEnvelope(data, trust, publicKey, defaultRepo); err == nil {
		t.Fatal("manifest with unexpected field was accepted")
	}
}
