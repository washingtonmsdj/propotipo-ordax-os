package physicalchannel

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurrentRequiresSignedCachedEnvelopeAndFreshBindings(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, err := json.Marshal(TrustAnchor{
		Schema: TrustSchema,
		KeyID: "ordax-prototype-release-v1",
		PublicKeyB64: base64.StdEncoding.EncodeToString(public),
	})
	if err != nil {
		t.Fatal(err)
	}
	trustDigest := sha256.Sum256(trustBytes)
	trustSHA := hex.EncodeToString(trustDigest[:])

	root := t.TempDir()
	commit := "0123456789abcdef0123456789abcdef01234567"
	directory := filepath.Join(root, "versions", commit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}

	names := []string{
		"ordax-creator-physical-test.exe",
		"ordax-bootstrap-seed.raw",
		"release-ed25519.json",
		"provenance.json",
		"SHA256SUMS",
	}
	bindings := make([]FileBinding, 0, len(names))
	for _, name := range names {
		body := []byte("verified-" + name)
		if err := os.WriteFile(filepath.Join(directory, name), body, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		bindings = append(bindings, FileBinding{Name: name, SHA256: hex.EncodeToString(digest[:]), Size: int64(len(body))})
	}
	manifest := Manifest{
		Schema: ManifestSchema,
		Purpose: Purpose,
		SourceRepository: SourceRepository,
		SourceCommit: commit,
		CreatedFromRecipe: Recipe,
		Bundle: Bundle{
			URL: "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/ordax-creator-physical-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size: 123,
		},
		Files: bindings,
	}
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelopeBytes, err := json.Marshal(Envelope{
		Schema: EnvelopeSchema,
		Payload: payload,
		Signature: ed25519.Sign(private, payload),
		KeyID: "ordax-prototype-release-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelopeBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	installed, err := Current(root, trustBytes, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if installed.SourceCommit != commit || installed.Directory != directory {
		t.Fatalf("unexpected cached candidate: %+v", installed)
	}

	if err := os.WriteFile(filepath.Join(directory, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered cached candidate unexpectedly accepted: %v", err)
	}
}

func TestCurrentRejectsTamperedCachedEnvelope(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trustBytes, _ := json.Marshal(TrustAnchor{Schema: TrustSchema, KeyID: "ordax-prototype-release-v1", PublicKeyB64: base64.StdEncoding.EncodeToString(public)})
	trustDigest := sha256.Sum256(trustBytes)
	trustSHA := hex.EncodeToString(trustDigest[:])
	manifest := validManifest()
	payload, _ := json.Marshal(manifest)
	signature := ed25519.Sign(private, payload)
	signature[0] ^= 0xff
	envelopeBytes, _ := json.Marshal(Envelope{Schema: EnvelopeSchema, Payload: payload, Signature: signature, KeyID: "ordax-prototype-release-v1"})
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelopeBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered cached envelope unexpectedly accepted: %v", err)
	}
}
