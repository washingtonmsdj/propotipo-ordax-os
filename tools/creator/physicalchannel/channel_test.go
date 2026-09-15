package physicalchannel

import (
	"archive/zip"
	"bytes"
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
		Schema: ManifestSchema, Purpose: Purpose, SourceRepository: SourceRepository,
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", CreatedFromRecipe: Recipe,
		Bundle: Bundle{URL: "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-physical/ordax-creator-physical-windows-amd64.zip", SHA256: strings.Repeat("a", 64), Size: 1234},
		Files: []FileBinding{
			{Name: "ordax-creator-physical-test.exe", SHA256: strings.Repeat("1", 64), Size: 11},
			{Name: "ordax-bootstrap-seed.raw", SHA256: strings.Repeat("2", 64), Size: 22},
			{Name: "release-ed25519.json", SHA256: strings.Repeat("3", 64), Size: 33},
			{Name: "provenance.json", SHA256: strings.Repeat("4", 64), Size: 44},
			{Name: "SHA256SUMS", SHA256: strings.Repeat("5", 64), Size: 55},
		},
	}
}

func signedEnvelope(t *testing.T, manifest Manifest, private ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil { t.Fatal(err) }
	envelope := Envelope{Schema: EnvelopeSchema, Payload: payload, Signature: ed25519.Sign(private, payload), KeyID: "ordax-prototype-release-v1"}
	data, err := json.Marshal(envelope)
	if err != nil { t.Fatal(err) }
	return data
}

func TestVerifyEnvelopeAcceptsBoundPhysicalPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest, err := VerifyEnvelope(signedEnvelope(t, validManifest(), private), trust, trustSHA)
	if err != nil { t.Fatal(err) }
	if manifest.Purpose != Purpose || manifest.SourceCommit == "" { t.Fatalf("unexpected manifest: %+v", manifest) }
}

func TestVerifyEnvelopeRejectsWrongTrustBytes(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	trust = append(append([]byte(nil), trust...), '\n')
	if _, err := VerifyEnvelope(signedEnvelope(t, validManifest(), private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "pinned SHA-256") { t.Fatalf("unexpected error: %v", err) }
}

func TestVerifyEnvelopeRejectsWrongPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest(); manifest.Purpose = "system-release"
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "purpose") { t.Fatalf("unexpected error: %v", err) }
}

func TestVerifyEnvelopeRejectsTamperedSignature(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	data := signedEnvelope(t, validManifest(), private)
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil { t.Fatal(err) }
	envelope.Signature[0] ^= 0xff; data, _ = json.Marshal(envelope)
	if _, err := VerifyEnvelope(data, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") { t.Fatalf("unexpected error: %v", err) }
}

func TestVerifyEnvelopeRejectsMissingOrDuplicateFileBindings(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest(); manifest.Files = manifest.Files[:4]
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil { t.Fatal("missing bound file unexpectedly accepted") }
	manifest = validManifest(); manifest.Files[4] = manifest.Files[0]
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil { t.Fatal("duplicate bound file unexpectedly accepted") }
}

func writeBoundFiles(t *testing.T, dir string) Manifest {
	t.Helper(); manifest := validManifest()
	for i := range manifest.Files {
		body := []byte("content-for-" + manifest.Files[i].Name)
		if err := os.WriteFile(filepath.Join(dir, manifest.Files[i].Name), body, 0o600); err != nil { t.Fatal(err) }
		digest := sha256.Sum256(body); manifest.Files[i].SHA256 = hex.EncodeToString(digest[:]); manifest.Files[i].Size = int64(len(body))
	}
	return manifest
}

func TestVerifyInstalledRehashesCriticalFilesEveryTime(t *testing.T) {
	dir := t.TempDir(); manifest := writeBoundFiles(t, dir)
	if err := VerifyInstalled(dir, manifest); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(dir, "provenance.json"), []byte("tampered"), 0o600); err != nil { t.Fatal(err) }
	if err := VerifyInstalled(dir, manifest); err == nil || !strings.Contains(err.Error(), "changed") { t.Fatalf("unexpected error: %v", err) }
}

func TestCurrentOfflineFallbackRechecksSignatureAndCriticalFiles(t *testing.T) {
	trust, private, trustSHA := testTrust(t); root := t.TempDir(); manifest := validManifest()
	dir := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(dir, 0o755); err != nil { t.Fatal(err) }
	manifest = writeBoundFiles(t, dir); envelope := signedEnvelope(t, manifest, private)
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil { t.Fatal(err) }
	installed, err := Current(root, trust, trustSHA)
	if err != nil { t.Fatal(err) }
	if installed.SourceCommit != manifest.SourceCommit || installed.Directory != dir { t.Fatalf("unexpected installed state: %+v", installed) }
	if err := os.WriteFile(filepath.Join(dir, "SHA256SUMS"), []byte("tampered"), 0o600); err != nil { t.Fatal(err) }
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") { t.Fatalf("tampered offline candidate unexpectedly accepted: %v", err) }
}

func zipWithEntries(t *testing.T, entries map[string][]byte) string {
	t.Helper(); path := filepath.Join(t.TempDir(), "candidate.zip"); file, err := os.Create(path)
	if err != nil { t.Fatal(err) }
	zw := zip.NewWriter(file)
	for name, body := range entries { w, err := zw.Create(name); if err != nil { t.Fatal(err) }; if _, err := w.Write(body); err != nil { t.Fatal(err) } }
	if err := zw.Close(); err != nil { t.Fatal(err) }; if err := file.Close(); err != nil { t.Fatal(err) }; return path
}

func TestExtractBundleRejectsUnexpectedAndTraversalFiles(t *testing.T) {
	manifest := validManifest(); zipPath := zipWithEntries(t, map[string][]byte{"evil.exe": []byte("x")}); dest := t.TempDir()
	if err := extractBundle(zipPath, dest, manifest); err == nil || !strings.Contains(err.Error(), "unexpected") { t.Fatalf("unexpected error: %v", err) }
	path := filepath.Join(t.TempDir(), "traversal.zip"); var data bytes.Buffer; zw := zip.NewWriter(&data); w, err := zw.Create("../evil")
	if err != nil { t.Fatal(err) }; _, _ = w.Write([]byte("x")); _ = zw.Close(); if err := os.WriteFile(path, data.Bytes(), 0o600); err != nil { t.Fatal(err) }
	if err := extractBundle(path, t.TempDir(), manifest); err == nil || !strings.Contains(err.Error(), "unsafe") { t.Fatalf("unexpected error: %v", err) }
}
