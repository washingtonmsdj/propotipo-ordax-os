package appchannel

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
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

func validManifest(body []byte, commit string, sequence int64) Manifest {
	digest := sha256.Sum256(body)
	return Manifest{
		Schema:            ManifestSchema,
		Purpose:           Purpose,
		SourceRepository:  SourceRepository,
		SourceCommit:      commit,
		Version:           "0.1.0",
		ReleaseSequence:   sequence,
		CreatedFromRecipe: Recipe,
		Artifact: Artifact{
			Name: ArtifactName,
			URL: ArtifactURL,
			SHA256: hex.EncodeToString(digest[:]),
			Size: int64(len(body)),
		},
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

type staticTransport struct {
	envelope []byte
	artifact []byte
}

func (s staticTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body := s.envelope
	contentType := "application/json"
	if req.URL.Path == "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe" {
		body = s.artifact
		contentType = "application/octet-stream"
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{"Content-Type": []string{contentType}},
		Body: io.NopCloser(strings.NewReader(string(body))),
		Request: req,
	}, nil
}

func TestVerifyEnvelopeAcceptsCanonicalAppPurpose(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	verified, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Purpose != Purpose || verified.ReleaseSequence != 1 {
		t.Fatalf("unexpected manifest: %+v", verified)
	}
}

func TestVerifyEnvelopeRejectsPurposeSignatureTrustAndSequence(t *testing.T) {
	trust, private, trustSHA := testTrust(t)
	manifest := validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	manifest.Purpose = "creator-inspection-windows-amd64"
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "identity/purpose") {
		t.Fatalf("wrong purpose error=%v", err)
	}

	manifest = validManifest([]byte("app"), "1111111111111111111111111111111111111111", 1)
	data := signedEnvelope(t, manifest, private)
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	env.Signature[0] ^= 0xff
	tampered, _ := json.Marshal(env)
	if _, err := VerifyEnvelope(tampered, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("signature error=%v", err)
	}
	if _, err := VerifyEnvelope(data, trust, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "pinned") {
		t.Fatalf("trust pin error=%v", err)
	}

	manifest.ReleaseSequence = 0
	if _, err := VerifyEnvelope(signedEnvelope(t, manifest, private), trust, trustSHA); err == nil || !strings.Contains(err.Error(), "source/version/sequence") {
		t.Fatalf("sequence error=%v", err)
	}
}

func TestAcquireCachesSignedAppAndCurrentWorksOffline(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("signed-authenticode-app-bytes-placeholder")
	manifest := validManifest(body, "2222222222222222222222222222222222222222", 2)
	envelope := signedEnvelope(t, manifest, private)
	client := &http.Client{Transport: staticTransport{envelope: envelope, artifact: body}}

	installed, changed, err := AcquireCached(client, root, "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-app/creator-app-envelope.json", trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || installed.ReleaseSequence != 2 || installed.SourceCommit != manifest.SourceCommit {
		t.Fatalf("unexpected installed app: %+v changed=%v", installed, changed)
	}
	if got, err := os.ReadFile(installed.Executable); err != nil || string(got) != string(body) {
		t.Fatalf("installed bytes mismatch: err=%v got=%q", err, got)
	}

	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.Executable != installed.Executable || current.ReleaseSequence != 2 {
		t.Fatalf("unexpected offline current: %+v", current)
	}
}

func TestCurrentRejectsTamperedInstalledApp(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("known-good-app")
	manifest := validManifest(body, "3333333333333333333333333333333333333333", 3)
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, manifest, private), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), []byte("tampered"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered app unexpectedly accepted: %v", err)
	}
}

func TestRollbackAndSequenceReuseAreRejected(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	body := []byte("current")
	currentManifest := validManifest(body, "4444444444444444444444444444444444444444", 4)
	directory := filepath.Join(root, "versions", currentManifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), signedEnvelope(t, currentManifest, private), 0o600); err != nil {
		t.Fatal(err)
	}

	older := validManifest([]byte("old"), "1111111111111111111111111111111111111111", 3)
	if err := checkRollback(root, older, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("rollback error=%v", err)
	}
	reused := validManifest([]byte("other"), "5555555555555555555555555555555555555555", 4)
	if err := checkRollback(root, reused, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("sequence reuse error=%v", err)
	}
	newer := validManifest([]byte("new"), "6666666666666666666666666666666666666666", 5)
	if err := checkRollback(root, newer, trust, trustSHA); err != nil {
		t.Fatalf("newer app rejected: %v", err)
	}
}
