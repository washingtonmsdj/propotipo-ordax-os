package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func validManifestBytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "release_id": "0123456789abcdef0123456789abcdef01234567",
  "created_from_ci_recipe": "release/native/1",
  "artifacts": [
    {
      "name": "system.tar",
      "role": "system",
      "url": "https://example.invalid/releases/system.tar",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "size": 123
    }
  ]
}
`)
}

func decodePrivateForTest(t *testing.T, path string) ed25519.PrivateKey {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	block, rest := pem.Decode(data)
	if block == nil || len(rest) != 0 {
		t.Fatal("private PEM did not decode cleanly")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		t.Fatal("generated key is not Ed25519")
	}
	return privateKey
}

func TestGenerateDeriveAndSignRoundTrip(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "release-private.pem")
	trustPath := filepath.Join(root, "release-trust.json")
	derivedPath := filepath.Join(root, "derived-trust.json")
	manifestPath := filepath.Join(root, "release-manifest.json")
	envelopePath := filepath.Join(root, "release-envelope.json")

	fingerprint, err := generateKeyFiles(privatePath, trustPath, "prototype-1")
	if err != nil {
		t.Fatalf("generateKeyFiles: %v", err)
	}
	if len(fingerprint) != 64 {
		t.Fatalf("fingerprint length = %d, want 64", len(fingerprint))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(privatePath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("private mode = %04o, want 0600", info.Mode().Perm())
		}
	}

	derivedFingerprint, err := deriveTrust(privatePath, derivedPath, "prototype-1")
	if err != nil {
		t.Fatalf("deriveTrust: %v", err)
	}
	if derivedFingerprint != fingerprint {
		t.Fatalf("derived fingerprint = %s, generated = %s", derivedFingerprint, fingerprint)
	}
	originalTrust, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	derivedTrust, err := os.ReadFile(derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(originalTrust) != string(derivedTrust) {
		t.Fatal("derived trust differs from generated trust")
	}

	manifestBytes := validManifestBytes()
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	commit, err := signManifest(manifestPath, privatePath, envelopePath, "prototype-1", defaultRepo)
	if err != nil {
		t.Fatalf("signManifest: %v", err)
	}
	if commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("commit = %q", commit)
	}

	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	if err := json.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != envelopeSchema || envelope.KeyID != "prototype-1" {
		t.Fatalf("unexpected envelope identity: %#v", envelope)
	}
	if string(envelope.Payload) != string(manifestBytes) {
		t.Fatal("signed envelope did not preserve exact manifest bytes")
	}

	var trust TrustAnchor
	if err := json.Unmarshal(originalTrust, &trust); err != nil {
		t.Fatal(err)
	}
	publicKey, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), envelope.Payload, envelope.Signature) {
		t.Fatal("signature did not verify with emitted trust anchor")
	}
}

func TestSignPreservesWhitespaceInExactPayload(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifest := append([]byte("\n  "), validManifestBytes()...)
	manifest = append(manifest, []byte("\n")...)
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privatePath, envelopePath, "prototype-1", defaultRepo); err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	data, _ := os.ReadFile(envelopePath)
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	if string(envelope.Payload) != string(manifest) {
		t.Fatal("payload whitespace changed during signing")
	}
}

func TestOutputsRefuseOverwrite(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if err := os.WriteFile(trustPath, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("generate overwrite error = %v", err)
	}
	if _, err := os.Stat(privatePath); !os.IsNotExist(err) {
		t.Fatalf("private key appeared despite preflight failure: %v", err)
	}
}

func TestSignRefusesExistingEnvelope(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, validManifestBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	if err := os.WriteFile(output, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := signManifest(manifestPath, privatePath, output, "prototype-1", defaultRepo); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("sign overwrite error = %v", err)
	}
	data, _ := os.ReadFile(output)
	if string(data) != "sentinel" {
		t.Fatalf("existing output changed: %q", data)
	}
}

func TestPrivateKeySymlinkIsRejected(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "private-link.pem")
	if err := os.Symlink(privatePath, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := loadPrivateKey(link); err == nil || !strings.Contains(err.Error(), "non-symlink") {
		t.Fatalf("symlink error = %v", err)
	}
}

func TestLoosePrivateKeyPermissionsAreRejectedOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission semantics do not apply")
	}
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(privatePath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPrivateKey(privatePath); err == nil || !strings.Contains(err.Error(), "permissions are too broad") {
		t.Fatalf("permission error = %v", err)
	}
}

func TestInvalidKeyIDRejectedBeforeKeyCreation(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "INVALID KEY"); err == nil {
		t.Fatal("invalid key id unexpectedly accepted")
	}
	if _, err := os.Stat(privatePath); !os.IsNotExist(err) {
		t.Fatalf("private key created for invalid key id: %v", err)
	}
}

func TestManifestRepositoryMismatchIsRejectedBeforeSigning(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "manifest.json")
	if err := os.WriteFile(manifestPath, validManifestBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "envelope.json")
	if _, err := signManifest(manifestPath, privatePath, output, "prototype-1", "someone/else"); err == nil || !strings.Contains(err.Error(), "unexpected source repository") {
		t.Fatalf("repository mismatch error = %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("envelope appeared after repository mismatch: %v", err)
	}
}

func TestDerivedTrustMatchesPrivatePublicKey(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	privateKey := decodePrivateForTest(t, privatePath)
	data, err := os.ReadFile(trustPath)
	if err != nil {
		t.Fatal(err)
	}
	var trust TrustAnchor
	if err := json.Unmarshal(data, &trust); err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(trust.PublicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(privateKey.Public().(ed25519.PublicKey)) {
		t.Fatal("trust public key does not match private key")
	}
}
