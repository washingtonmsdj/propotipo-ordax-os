package physicalchannel

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sequencedCandidate(t *testing.T, root, commit string, sequence int64) Installed {
	t.Helper()
	manifest := validManifest()
	manifest.SourceCommit = commit
	directory := filepath.Join(root, "versions", commit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	provenance := physicalProvenance{
		Schema:                          physicalProvenanceSchema,
		Status:                          "authorized-candidate-not-published",
		SourceCommit:                    commit,
		ReleaseSequence:                 sequence,
		ConsumerKeySetupRequired:        false,
		DevelopmentChannel:              false,
		CanonicalTrustSHA256:            strings.Repeat("1", 64),
		MinimalBootstrapSHA256:          strings.Repeat("2", 64),
		PhysicalMediaSHA256:             strings.Repeat("3", 64),
		SeedSHA256:                      strings.Repeat("4", 64),
		SeedSize:                        4096,
		RawBackendLinked:                true,
		PhysicalWriteAuthorizedInBinary: true,
		ReleasePublished:                false,
		PrivateKeyInCandidate:           false,
	}
	provenanceBytes, err := json.Marshal(provenance)
	if err != nil {
		t.Fatal(err)
	}
	bodies := map[string][]byte{
		"ordax-creator-physical-test.exe": []byte("writer"),
		"ordax-bootstrap-seed.raw":         []byte("seed"),
		"release-ed25519.json":             []byte("trust"),
		"provenance.json":                  provenanceBytes,
		"SHA256SUMS":                       []byte("checksums"),
	}
	for i := range manifest.Files {
		body := bodies[manifest.Files[i].Name]
		if err := os.WriteFile(filepath.Join(directory, manifest.Files[i].Name), body, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		manifest.Files[i].SHA256 = hex.EncodeToString(digest[:])
		manifest.Files[i].Size = int64(len(body))
	}
	return Installed{SourceCommit: commit, Directory: directory, Manifest: manifest}
}

func cacheSignedCandidate(t *testing.T, root string, installed Installed, private ed25519.PrivateKey) {
	t.Helper()
	envelope := signedEnvelope(t, installed.Manifest, private)
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCurrentRequiresBoundMonotonicSequence(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	installed := sequencedCandidate(t, root, "1111111111111111111111111111111111111111", 2)
	cacheSignedCandidate(t, root, installed, private)

	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	sequence, err := ReleaseSequence(current)
	if err != nil {
		t.Fatal(err)
	}
	if sequence != 2 {
		t.Fatalf("sequence=%d want=2", sequence)
	}

	if err := os.WriteFile(filepath.Join(installed.Directory, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered provenance error=%v", err)
	}
}

func TestEnsureNotRollbackRejectsOlderSignedCandidate(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	current := sequencedCandidate(t, root, "2222222222222222222222222222222222222222", 2)
	cacheSignedCandidate(t, root, current, private)
	older := sequencedCandidate(t, root, "1111111111111111111111111111111111111111", 1)

	if err := ensureNotRollback(root, older, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("rollback error=%v", err)
	}
}

func TestEnsureNotRollbackRejectsSequenceReuseAndAllowsAdvance(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	current := sequencedCandidate(t, root, "2222222222222222222222222222222222222222", 2)
	cacheSignedCandidate(t, root, current, private)
	reused := sequencedCandidate(t, root, "3333333333333333333333333333333333333333", 2)
	newer := sequencedCandidate(t, root, "4444444444444444444444444444444444444444", 3)

	if err := ensureNotRollback(root, reused, trust, trustSHA); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("sequence reuse error=%v", err)
	}
	if err := ensureNotRollback(root, newer, trust, trustSHA); err != nil {
		t.Fatalf("newer candidate rejected: %v", err)
	}
}
