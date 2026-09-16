package appchannel

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func installSignedBaseline(t *testing.T, root string, body []byte, manifest Manifest, envelope []byte) {
	t.Helper()
	directory := filepath.Join(root, "versions", manifest.SourceCommit)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ArtifactName), body, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelope, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestPendingUpdateKeepsCurrentUntilPromotionAndPreservesPrevious(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)

	oldBody := []byte("old-known-good-app")
	oldManifest := validManifest(oldBody, "1111111111111111111111111111111111111111", 1)
	oldEnvelope := signedEnvelope(t, oldManifest, private)
	installSignedBaseline(t, root, oldBody, oldManifest, oldEnvelope)

	newBody := []byte("new-healthcheck-candidate")
	newManifest := validManifest(newBody, "2222222222222222222222222222222222222222", 2)
	newEnvelope := signedEnvelope(t, newManifest, private)
	client := &http.Client{Transport: staticTransport{envelope: newEnvelope, artifact: newBody}}

	pending, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || pending.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("unexpected pending update: %+v changed=%v", pending, changed)
	}
	current, err := Current(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("pending candidate replaced current before health-check: %+v", current)
	}

	promoted, err := PromotePending(root, pending.SourceCommit, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if promoted.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("wrong promoted app: %+v", promoted)
	}
	current, err = Current(root, trust, trustSHA)
	if err != nil || current.SourceCommit != newManifest.SourceCommit {
		t.Fatalf("new current mismatch: %+v err=%v", current, err)
	}
	previous, err := Previous(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if previous.SourceCommit != oldManifest.SourceCommit || previous.ReleaseSequence != 1 {
		t.Fatalf("previous known-good was not preserved: %+v", previous)
	}
	if _, err := os.Stat(filepath.Join(root, pendingEnvelopeName)); !os.IsNotExist(err) {
		t.Fatalf("pending envelope survived promotion: %v", err)
	}
}

func TestDiscardPendingLeavesCurrentKnownGood(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	oldBody := []byte("stable")
	oldManifest := validManifest(oldBody, "3333333333333333333333333333333333333333", 3)
	installSignedBaseline(t, root, oldBody, oldManifest, signedEnvelope(t, oldManifest, private))

	newBody := []byte("broken-candidate")
	newManifest := validManifest(newBody, "4444444444444444444444444444444444444444", 4)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, newManifest, private), artifact: newBody}}
	if _, changed, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA); err != nil || !changed {
		t.Fatalf("AcquirePending changed=%v err=%v", changed, err)
	}
	if err := DiscardPending(root); err != nil {
		t.Fatal(err)
	}
	current, err := LastKnownGood(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if current.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("discarded candidate changed known-good: %+v", current)
	}
}

func TestLastKnownGoodFallsBackToPreviousAfterCurrentCorruption(t *testing.T) {
	root := t.TempDir()
	trust, private, trustSHA := testTrust(t)
	oldBody := []byte("old-good")
	oldManifest := validManifest(oldBody, "5555555555555555555555555555555555555555", 5)
	installSignedBaseline(t, root, oldBody, oldManifest, signedEnvelope(t, oldManifest, private))

	newBody := []byte("new-good")
	newManifest := validManifest(newBody, "6666666666666666666666666666666666666666", 6)
	client := &http.Client{Transport: staticTransport{envelope: signedEnvelope(t, newManifest, private), artifact: newBody}}
	pending, _, err := AcquirePending(client, root, DefaultEnvelopeURL, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := PromotePending(root, pending.SourceCommit, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(promoted.Executable, []byte("tampered-current"), 0o700); err != nil {
		t.Fatal(err)
	}
	fallback, err := LastKnownGood(root, trust, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if fallback.SourceCommit != oldManifest.SourceCommit {
		t.Fatalf("did not fall back to previous signed app: %+v", fallback)
	}
}
