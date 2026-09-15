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
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil { t.Fatal(err) }
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil { t.Fatal(err) }
	privatePath := filepath.Join(root, "private.pem")
	if err := os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil { t.Fatal(err) }
	trustPath := filepath.Join(root, "trust.json")
	trust := trustAnchor{Schema: trustSchema, KeyID: "ordax-prototype-release-v1", PublicKeyB64: base64.StdEncoding.EncodeToString(public)}
	data, _ := json.Marshal(trust)
	if err := os.WriteFile(trustPath, data, 0o644); err != nil { t.Fatal(err) }
	return privatePath, trustPath
}

func validPhysicalManifestBytes() []byte {
	m := manifest{
		Schema: manifestSchema, Purpose: purpose, SourceRepository: repository,
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", CreatedFromRecipe: recipe,
		Bundle: bundle{URL: "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/ordax-creator-physical-windows-amd64.zip", SHA256: strings.Repeat("a", 64), Size: 1234},
		Files: []fileBinding{
			{Name: "ordax-creator-physical-test.exe", SHA256: strings.Repeat("1", 64), Size: 11},
			{Name: "ordax-bootstrap-seed.raw", SHA256: strings.Repeat("2", 64), Size: 22},
			{Name: "release-ed25519.json", SHA256: strings.Repeat("3", 64), Size: 33},
			{Name: "provenance.json", SHA256: strings.Repeat("4", 64), Size: 44},
			{Name: "SHA256SUMS", SHA256: strings.Repeat("5", 64), Size: 55},
		},
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	return append(data, '\n')
}

func TestSignPhysicalRoundTrip(t *testing.T) {
	root := t.TempDir()
	privatePath, trustPath := writeIdentity(t, root)
	manifestPath := filepath.Join(root, "manifest.json")
	manifestBytes := validPhysicalManifestBytes()
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil { t.Fatal(err) }
	output := filepath.Join(root, "envelope.json")
	commit, err := signPhysical(manifestPath, privatePath, trustPath, output, "ordax-prototype-release-v1")
	if err != nil { t.Fatal(err) }
	if commit != "0123456789abcdef0123456789abcdef01234567" { t.Fatalf("commit=%s", commit) }
	var env envelope
	data, err := os.ReadFile(output)
	if err != nil { t.Fatal(err) }
	if err := json.Unmarshal(data, &env); err != nil { t.Fatal(err) }
	if env.Schema != envelopeSchema || env.KeyID != "ordax-prototype-release-v1" || string(env.Payload) != string(manifestBytes) { t.Fatalf("unexpected envelope: %+v", env) }
	var trust trustAnchor
	trustBytes, _ := os.ReadFile(trustPath)
	_ = json.Unmarshal(trustBytes, &trust)
	public, _ := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if !ed25519.Verify(ed25519.PublicKey(public), env.Payload, env.Signature) { t.Fatal("signature failed verification") }
}

func TestPhysicalSignerRejectsPurposeAndExtraFile(t *testing.T) {
	var m manifest
	_ = json.Unmarshal(validPhysicalManifestBytes(), &m)
	m.Purpose = "release/native/1"
	data, _ := json.Marshal(m)
	if _, err := validateManifest(data); err == nil || !strings.Contains(err.Error(), "identity/purpose") { t.Fatalf("wrong purpose error=%v", err) }
	_ = json.Unmarshal(validPhysicalManifestBytes(), &m)
	m.Files = append(m.Files, fileBinding{Name: "evil.exe", SHA256: strings.Repeat("6", 64), Size: 1})
	data, _ = json.Marshal(m)
	if _, err := validateManifest(data); err == nil { t.Fatal("extra file unexpectedly accepted") }
}

func TestPhysicalSignerRejectsWrongKeyAndOverwrite(t *testing.T) {
	root := t.TempDir()
	privateA, trustA := writeIdentity(t, filepath.Join(root, "a"))
	_ = trustA
	privateB, trustB := writeIdentity(t, filepath.Join(root, "b"))
	_ = privateB
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, validPhysicalManifestBytes(), 0o644); err != nil { t.Fatal(err) }
	output := filepath.Join(root, "envelope.json")
	if _, err := signPhysical(manifestPath, privateA, trustB, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "does not match") { t.Fatalf("mismatch error=%v", err) }
	if err := os.WriteFile(output, []byte("sentinel"), 0o644); err != nil { t.Fatal(err) }
	if _, err := signPhysical(manifestPath, privateA, trustA, output, "ordax-prototype-release-v1"); err == nil || !strings.Contains(err.Error(), "already exists") { t.Fatalf("overwrite error=%v", err) }
	data, _ := os.ReadFile(output)
	if string(data) != "sentinel" { t.Fatal("existing output changed") }
}
