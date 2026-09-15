package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const testCommit = "0123456789abcdef0123456789abcdef01234567"

func testKeys(t *testing.T) (TrustAnchor, ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{
		Schema:       trustSchema,
		KeyID:        "prototype-1",
		PublicKeyB64: base64.StdEncoding.EncodeToString(pub),
	}
	return trust, pub, priv
}

func signedEnvelope(t *testing.T, manifest Manifest, keyID string, priv ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		Schema:    envelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(priv, payload),
		KeyID:     keyID,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func manifestFor(rawURL string, data []byte) Manifest {
	digest := sha256.Sum256(data)
	return Manifest{
		Schema:              manifestSchema,
		SourceRepository:    defaultRepo,
		SourceCommit:        testCommit,
		ReleaseID:           testCommit,
		CreatedFromCIRecipe: "release-agent-test/1",
		Artifacts: []Artifact{{
			Name:   "system.tar",
			Role:   "system",
			URL:    rawURL,
			SHA256: hex.EncodeToString(digest[:]),
			Size:   int64(len(data)),
		}},
	}
}

func TestVerifyEnvelopeAcceptsExactSignedPayload(t *testing.T) {
	trust, pub, priv := testKeys(t)
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	data := signedEnvelope(t, m, trust.KeyID, priv)
	got, payload, err := verifyEnvelope(data, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if got.SourceCommit != testCommit || len(payload) == 0 {
		t.Fatalf("unexpected verified manifest: %#v", got)
	}
}

func TestVerifyEnvelopeRejectsTamperedPayload(t *testing.T) {
	trust, pub, priv := testKeys(t)
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	data := signedEnvelope(t, m, trust.KeyID, priv)
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload[0] ^= 1
	data, _ = json.Marshal(envelope)
	if _, _, err := verifyEnvelope(data, trust, pub, defaultRepo); err == nil {
		t.Fatal("tampered signed payload was accepted")
	}
}

func TestManifestRejectsNonHTTPSArtifact(t *testing.T) {
	m := manifestFor("http://example.invalid/system.tar", []byte("payload"))
	if err := validateManifest(m, defaultRepo); err == nil {
		t.Fatal("HTTP artifact URL was accepted")
	}
}

func TestManifestRejectsPathTraversalAndRepositoryMismatch(t *testing.T) {
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	m.Artifacts[0].Name = "../system.tar"
	if err := validateManifest(m, defaultRepo); err == nil {
		t.Fatal("path traversal artifact was accepted")
	}
	m = manifestFor("https://example.invalid/system.tar", []byte("payload"))
	if err := validateManifest(m, "someone/else"); err == nil {
		t.Fatal("repository mismatch was accepted")
	}
}

func TestInstallActivatesOnlyVerifiedRelease(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := []byte("verified ordax release")
	var envelope []byte
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope = signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(artifact)
	})
	root := t.TempDir()
	receipt, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Idempotent || receipt.SourceCommit != testCommit {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", testCommit) {
		t.Fatalf("unexpected current target: %s", current)
	}
	got, err := os.ReadFile(filepath.Join(root, "releases", testCommit, "system.tar"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(artifact) {
		t.Fatal("materialized artifact differs")
	}
	second, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Idempotent {
		t.Fatal("reinstall of identical release was not idempotent")
	}
}

func TestFailedNewReleasePreservesCurrentKnownGood(t *testing.T) {
	trust, pub, priv := testKeys(t)
	served := []byte("corrupt bytes")
	declared := []byte("expected bytes")
	var envelope []byte
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", declared)
	envelope = signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(served)
	})
	root := t.TempDir()
	old := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := os.MkdirAll(filepath.Join(root, "releases", old), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("releases", old), filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}
	if _, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo); err == nil {
		t.Fatal("corrupt release was installed")
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", old) {
		t.Fatalf("known-good current changed after failed update: %s", current)
	}
	if _, err := os.Stat(filepath.Join(root, "releases", testCommit)); !os.IsNotExist(err) {
		t.Fatal("failed release target survived verification failure")
	}
}

func TestLoadTrustRejectsSymlink(t *testing.T) {
	trust, _, _ := testKeys(t)
	data, _ := json.Marshal(trust)
	dir := t.TempDir()
	real := filepath.Join(dir, "trust.json")
	link := filepath.Join(dir, "trust-link.json")
	if err := os.WriteFile(real, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadTrust(link); err == nil {
		t.Fatal("symlink trust anchor was accepted")
	}
}
