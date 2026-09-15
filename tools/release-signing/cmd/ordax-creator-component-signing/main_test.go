package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeIdentity(t *testing.T, root string) (string, string) {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	privatePath := filepath.Join(root, "private.pem")
	if err := os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	trustPath := filepath.Join(root, "trust.json")
	trust := trustAnchor{Schema: trustSchema, KeyID: "ordax-prototype-release-v1", PublicKeyB64: base64.StdEncoding.EncodeToString(public)}
	data, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(trustPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return privatePath, trustPath
}

func validManifestBytes() []byte {
	m := manifest{
		Schema:            manifestSchema,
		Purpose:           purpose,
		SourceRepository:  repository,
		SourceCommit:      "0123456789abcdef0123456789abcdef01234567",
		Version:           "1.0.0",
		ReleaseSequence:   1,
		CreatedFromRecipe: recipe,
		Bundle: bundle{
			URL:    "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/ordax-creator-components-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size:   1234,
		},
		File: fileBinding{Name: componentName, SHA256: strings.Repeat("b", 64), Size: 4321},
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	return append(data, '\n')
}

func TestSignComponentRoundTripPreservesExactManifestBytes(t *testing.T) {
	root := t.TempDir()
	privatePath, trustPath := writeIdentity(t, root)
	manifestPath := filepath.Join(root, "manifest.json")
	manifestBytes := validManifestBytes()
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	m, err := signComponent(manifestPath, privatePath, trustPath, output, "ordax-prototype-release-v1")
	if err != nil {
		t.Fatal(err)
	}
	if m.ReleaseSequence != 1 || m.Purpose != purpose {
		t.Fatalf("unexpected signed manifest: %+v", m)
	}
	var env envelope
	envelopeBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(envelopeBytes, &env); err != nil {
		t.Fatal(err)
	}
	if env.Schema != envelopeSchema || env.KeyID != "ordax-prototype-release-v1" || string(env.Payload) != string(manifestBytes) {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	var trust trustAnchor
	trustBytes, _ := os.ReadFile(trustPath)
	if err := json.Unmarshal(trustBytes, &trust); err != nil {
		t.Fatal(err)
	}
	public, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(ed25519.PublicKey(public), env.Payload, env.Signature) {
		t.Fatal("signature failed verification")
	}
}

func TestComponentSignerRejectsWrongPurposeSequenceAndURL(t *testing.T) {
	var m manifest
	if err := json.Unmarshal(validManifestBytes(), &m); err != nil {
		t.Fatal(err)
	}
	m.Purpose = "creator-physical-windows-amd64"
	data, _ := json.Marshal(m)
	if _, err := validateManifest(data); err == nil || !strings.Contains(err.Error(), "identity/purpose") {
		t.Fatalf("wrong purpose error=%v", err)
	}

	_ = json.Unmarshal(validManifestBytes(), &m)
	m.ReleaseSequence = 0
	data, _ = json.Marshal(m)
	if _, err := validateManifest(data); err == nil || !strings.Contains(err.Error(), "source/version/sequence") {
		t.Fatalf("invalid sequence error=%v", err)
	}

	_ = json.Unmarshal(validManifestBytes(), &m)
	m.Bundle.URL = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/ordax-creator-components-windows-amd64.zip"
	data, _ = json.Marshal(m)
	if _, err := validateManifest(data); err == nil || !strings.Contains(err.Error(), "creator-components") {
		t.Fatalf("wrong URL error=%v", err)
	}
}

func TestComponentSignerRejectsWrongKeyAndOverwrite(t *testing.T) {
	root := t.TempDir()
	privateA, trustA := writeIdentity(t, filepath.Join(root, "a"))
	_, trustB := writeIdentity(t, filepath.Join(root, "b"))
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, validManifestBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	if _, err := signComponent(manifestPath, privateA, trustB, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("key mismatch error=%v", err)
	}
	if err := os.WriteFile(output, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := signComponent(manifestPath, privateA, trustA, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("overwrite error=%v", err)
	}
	data, _ := os.ReadFile(output)
	if string(data) != "sentinel" {
		t.Fatal("existing envelope changed")
	}
}

func TestComponentSignerRejectsUnknownManifestField(t *testing.T) {
	data := []byte(`{"$schema":"prototype-ordax.creator-component-manifest/1","purpose":"creator-inspection-windows-amd64","source_repository":"washingtonmsdj/prototipo-ordax-os","source_commit":"0123456789abcdef0123456789abcdef01234567","version":"1.0.0","release_sequence":1,"created_from_recipe":"creator/component/windows/1","bundle":{"url":"https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/ordax-creator-components-windows-amd64.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1},"file":{"name":"ordax-creator-physical-test.exe","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","size":1},"unexpected":true}`)
	if _, err := validateManifest(data); err == nil {
		t.Fatal("unknown manifest field unexpectedly accepted")
	}
}
