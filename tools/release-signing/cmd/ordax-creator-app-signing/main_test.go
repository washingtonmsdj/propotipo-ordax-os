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

func realTestDir(t *testing.T) string {
	t.Helper()
	root, err := os.MkdirTemp(".", ".ordax-app-signing-test-*")
	if err != nil {
		t.Fatal(err)
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		_ = os.RemoveAll(root)
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(absolute) })
	return absolute
}

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
		Version:           "0.1.0",
		ReleaseSequence:   1,
		CreatedFromRecipe: recipe,
		Artifact: artifact{
			Name:   artifactName,
			URL:    artifactURL,
			SHA256: strings.Repeat("a", 64),
			Size:   12345,
		},
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	return append(data, '\n')
}

func TestSignAppRoundTripPreservesExactManifestBytes(t *testing.T) {
	root := realTestDir(t)
	privatePath, trustPath := writeIdentity(t, root)
	manifestPath := filepath.Join(root, "manifest.json")
	manifestBytes := validManifestBytes()
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	m, err := signApp(manifestPath, privatePath, trustPath, output, "ordax-prototype-release-v1")
	if err != nil {
		t.Fatal(err)
	}
	if m.Purpose != purpose || m.ReleaseSequence != 1 {
		t.Fatalf("unexpected manifest: %+v", m)
	}
	var env envelope
	data, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &env); err != nil {
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

func TestAppSignerRejectsWrongPurposeSequenceAndURL(t *testing.T) {
	var m manifest
	if err := json.Unmarshal(validManifestBytes(), &m); err != nil {
		t.Fatal(err)
	}
	m.Purpose = "creator-inspection-windows-amd64"
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
	m.Artifact.URL = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/OrdaX-Creator-App.exe"
	data, _ = json.Marshal(m)
	if _, err := validateManifest(data); err == nil || !strings.Contains(err.Error(), "creator-app") {
		t.Fatalf("wrong URL error=%v", err)
	}
}

func TestAppSignerRejectsWrongKeyAndOverwrite(t *testing.T) {
	root := realTestDir(t)
	privateA, trustA := writeIdentity(t, filepath.Join(root, "a"))
	_, trustB := writeIdentity(t, filepath.Join(root, "b"))
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, validManifestBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	if _, err := signApp(manifestPath, privateA, trustB, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("key mismatch error=%v", err)
	}
	if err := os.WriteFile(output, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := signApp(manifestPath, privateA, trustA, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("overwrite error=%v", err)
	}
	data, _ := os.ReadFile(output)
	if string(data) != "sentinel" {
		t.Fatal("existing envelope changed")
	}
}

func TestAppSignerRejectsUnknownManifestField(t *testing.T) {
	data := []byte(`{"$schema":"prototype-ordax.creator-app-manifest/1","purpose":"creator-app-windows-amd64","source_repository":"washingtonmsdj/prototipo-ordax-os","source_commit":"0123456789abcdef0123456789abcdef01234567","version":"0.1.0","release_sequence":1,"created_from_recipe":"creator/app/windows/1","artifact":{"name":"OrdaX-Creator-App.exe","url":"https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1},"unexpected":true}`)
	if _, err := validateManifest(data); err == nil {
		t.Fatal("unknown manifest field unexpectedly accepted")
	}
}
