package physicalchannel

import (
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurrentRequiresSignedCachedEnvelopeAndFreshBindings(t *testing.T) {
	root := t.TempDir()
	trustBytes, private, trustSHA := testTrust(t)
	commit := "0123456789abcdef0123456789abcdef01234567"
	candidate := sequencedCandidate(t, root, commit, 1)
	cacheSignedCandidate(t, root, candidate, private)

	installed, err := Current(root, trustBytes, trustSHA)
	if err != nil {
		t.Fatal(err)
	}
	if installed.SourceCommit != commit || installed.Directory != candidate.Directory {
		t.Fatalf("unexpected cached candidate: %+v", installed)
	}
	sequence, err := ReleaseSequence(installed)
	if err != nil {
		t.Fatal(err)
	}
	if sequence != 1 {
		t.Fatalf("release sequence=%d want=1", sequence)
	}

	if err := os.WriteFile(filepath.Join(candidate.Directory, "provenance.json"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("tampered cached candidate unexpectedly accepted: %v", err)
	}
}

func TestCurrentRejectsTamperedCachedEnvelope(t *testing.T) {
	trustBytes, private, trustSHA := testTrust(t)
	manifest := validManifest()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(private, payload)
	signature[0] ^= 0xff
	envelopeBytes, err := json.Marshal(Envelope{
		Schema: EnvelopeSchema,
		Payload: payload,
		Signature: signature,
		KeyID: "ordax-prototype-release-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, currentEnvelopeName), envelopeBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Current(root, trustBytes, trustSHA); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered cached envelope unexpectedly accepted: %v", err)
	}
}
