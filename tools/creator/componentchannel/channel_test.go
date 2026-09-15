package componentchannel

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

func testTrust(t *testing.T) ([]byte, ed25519.PrivateKey, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{Schema: TrustSchema, KeyID: "ordax-prototype-release-v1", PublicKeyB64: base64.StdEncoding.EncodeToString(public)}
	data, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return data, private, hex.EncodeToString(digest[:])
}

func validManifest() Manifest {
	return Manifest{
		Schema:            ManifestSchema,
		Purpose:           Purpose,
		SourceRepository:  SourceRepository,
		SourceCommit:      "1111111111111111111111111111111111111111",
		Version:           "1.0.0",
		ReleaseSequence:   1,
		CreatedFromRecipe: Recipe,
		Bundle: Bundle{
			URL:    "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-components/ordax-creator-components-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size:   1234,
		},
		File: FileBinding{Name: expectedFile, SHA256: strings.Repeat("b", 64), Size: 123},
	}
}

func signedEnvelope(t *testing.T, manifest Manifest, private ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{Schema: EnvelopeSchema, Payload: payload, Signature: ed25519.Sign(private, payload), KeyID: "ordax-prototype-release-v1"}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func installManifest(t *testing.T, root string, manifest Manifest, body []byte) Manifest {
	t.Helper()
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, expectedFile), body, 0o700); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	manifest.File.SHA256 = hex.EncodeToString(digest[:])
	manifest.File.Size = int64(len(body))
	return manifest
}

func TestVerifyEnvelopeAcceptsCanonicalPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest, err := VerifyEnvelope(signedEnvelope(t, validManifest(), private), trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Purpose != Purpose || manifest.ReleaseSequence != 1 {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
}

func TestVerifyEnvelopeRejectsWrongPurposeSignatureAndTrust(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	wrongPurpose := validManifest()
	wrongPurpose.Purpose = "creator-physical-windows-amd64"
	if _, err := VerifyEnvelope(signedEnvelope(t, wrongPurpose, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "identity/purpose") {
		t.Fatalf("wrong purpose error=%v", err)
	}

	envelopeBytes := signedEnvelope(t, validManifest(), private)
	var envelope Envelope
	if err := json.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Signature[0] ^= 0xff
	tampered, _ := json.Marshal(envelope)
	if _, err := VerifyEnvelope(tampered, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered signature error=%v", err)
	}

	if _, err := VerifyEnvelope(envelopeBytes, trust, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "pinned") {
		t.Fatalf("wrong trust hash error=%v", err)
	}
}

func TestVerifyEnvelopeRejectsInvalidSequence(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest()
	manifest.ReleaseSequence = 0
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "release_sequence") {
		t.Fatalf("invalid sequence error=%v", err)
	}
}

func TestVerifyInstalledRehashesAndRejectsExtraFiles(t *testing.T) {
	root := t.TempDir()
	manifest := installManifest(t, root, validManifest(), []byte("inspection-backend"))
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := VerifyInstalled(directory, manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "extra.exe"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyInstalled(directory, manifest); err == nil || !strings.Contains(err.Error(), "exactly") {
		t.Fatalf("extra file error=%v", err)
	}
	if err := os.Remove(filepath.Join(directory, "extra.exe")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, expectedFile), []byte("tampered"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := VerifyInstalled(directory, manifest); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tamper error=%v", err)
	}
}

func TestRollbackPolicyRejectsOlderAndSequenceReuse(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	current := validManifest()
	current.SourceCommit = "2222222222222222222222222222222222222222"
	current.ReleaseSequence = 2
	current = installManifest(t, root, current, []byte("current"))
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, current, private), 0o600); err != nil {
		t.Fatal(err)
	}

	older := validManifest()
	older.SourceCommit = "1111111111111111111111111111111111111111"
	older.ReleaseSequence = 1
	if err := checkRollback(root, older, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("older error=%v", err)
	}

	reused := validManifest()
	reused.SourceCommit = "3333333333333333333333333333333333333333"
	reused.ReleaseSequence = 2
	if err := checkRollback(root, reused, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("reuse error=%v", err)
	}

	newer := validManifest()
	newer.SourceCommit = "4444444444444444444444444444444444444444"
	newer.ReleaseSequence = 3
	if err := checkRollback(root, newer, trust, trustSHA); err != nil {
		t.Fatalf("newer candidate rejected: %v", err)
	}
}
