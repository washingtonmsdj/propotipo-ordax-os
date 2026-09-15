package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func canonicalManifestBytes(t *testing.T) []byte {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(here), "..", "..", "..", "docs", "contracts", "minimal-bootstrap.json"))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read canonical manifest: %v", err)
	}
	return data
}

func resolvedFixture(t *testing.T, payloadRoot string, payload []byte) Manifest {
	t.Helper()
	m, err := ParseManifest(canonicalManifestBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	sha := hex.EncodeToString(digest[:])
	for i := range m.ArtifactGroups {
		m.ArtifactGroups[i].Resolved = true
		m.ArtifactGroups[i].Artifacts = []Artifact{{
			SourcePath:   "payload/example.bin",
			TargetPath:   "/fixture/" + m.ArtifactGroups[i].ID + ".bin",
			SHA256:       sha,
			Mode:         "0644",
			LogicalOwner: "test-owner",
			Reason:       "test fixture",
		}}
	}
	m.AllArtifactsResolved = true
	if payloadRoot != "" {
		path := filepath.Join(payloadRoot, "payload", "example.bin")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return m
}

func TestCanonicalManifestIsStructurallyValidAndWriteBlocked(t *testing.T) {
	m, err := ParseManifest(canonicalManifestBytes(t))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := ValidateStructure(m); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if got := PhysicalWriteStatus(m); got != "blocked" {
		t.Fatalf("write status = %q, want blocked", got)
	}
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "blocked") {
		t.Fatalf("BuildWritePlan error = %v, want fail-closed block", err)
	}
}

func TestRejectsAnyThirdPartition(t *testing.T) {
	m, err := ParseManifest(canonicalManifestBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	m.Partitions = append(m.Partitions, Partition{Name: "ORDAX-HOME", Role: "legacy"})
	if err := ValidateStructure(m); err == nil {
		t.Fatal("expected three-partition layout to be rejected")
	}
}

func TestAuthorizedFixtureProducesDeterministicTwoPartitionPlan(t *testing.T) {
	m := resolvedFixture(t, "", []byte("ordax-fixture"))
	m.PhysicalWriteAllowed = true
	plan, err := BuildWritePlan(m)
	if err != nil {
		t.Fatalf("BuildWritePlan: %v", err)
	}
	if len(plan.PartitionIDs) != 2 || plan.PartitionIDs[0] != "ORDAX-ESP" || plan.PartitionIDs[1] != "ORDAX" {
		t.Fatalf("unexpected partitions: %#v", plan.PartitionIDs)
	}
	if len(plan.Artifacts) != len(m.ArtifactGroups) {
		t.Fatalf("artifact count = %d, want %d", len(plan.Artifacts), len(m.ArtifactGroups))
	}
	for i := 1; i < len(plan.Artifacts); i++ {
		previous, current := plan.Artifacts[i-1], plan.Artifacts[i]
		if previous.Partition > current.Partition || (previous.Partition == current.Partition && previous.TargetPath > current.TargetPath) {
			t.Fatalf("plan is not deterministically sorted at %d", i)
		}
	}
}

func TestResolvedPayloadCanBeVerifiedBeforeWriteAuthorization(t *testing.T) {
	root := t.TempDir()
	m := resolvedFixture(t, root, []byte("verified-payload"))
	if m.PhysicalWriteAllowed {
		t.Fatal("fixture must remain physically unauthorized")
	}
	result, err := VerifyPayload(m, root)
	if err != nil {
		t.Fatalf("VerifyPayload: %v", err)
	}
	if result.ArtifactCount != len(m.ArtifactGroups) {
		t.Fatalf("artifact count = %d, want %d", result.ArtifactCount, len(m.ArtifactGroups))
	}
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "not authorized") {
		t.Fatalf("write should remain blocked after byte verification: %v", err)
	}
}

func TestPayloadVerificationRejectsTampering(t *testing.T) {
	root := t.TempDir()
	m := resolvedFixture(t, root, []byte("expected"))
	path := filepath.Join(root, "payload", "example.bin")
	if err := os.WriteFile(path, []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyPayload(m, root); err == nil || !strings.Contains(err.Error(), "SHA-256 mismatch") {
		t.Fatalf("tampered payload error = %v", err)
	}
}

func TestRejectsUnsafeBundleSourcePath(t *testing.T) {
	m := resolvedFixture(t, "", []byte("x"))
	m.PhysicalWriteAllowed = true
	m.ArtifactGroups[0].Artifacts[0].SourcePath = "../escape.bin"
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "unsafe artifact") {
		t.Fatalf("unsafe source path error = %v", err)
	}
}

func TestRejectsDuplicatePartitionTarget(t *testing.T) {
	m := resolvedFixture(t, "", []byte("x"))
	m.PhysicalWriteAllowed = true
	first := -1
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX" {
			if first == -1 {
				first = i
				continue
			}
			m.ArtifactGroups[i].Artifacts[0].TargetPath = m.ArtifactGroups[first].Artifacts[0].TargetPath
			if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "duplicate target") {
				t.Fatalf("duplicate target error = %v", err)
			}
			return
		}
	}
	t.Fatal("fixture did not contain two ORDAX groups")
}

func TestRejectsMalformedArtifactHash(t *testing.T) {
	m := resolvedFixture(t, "", []byte("x"))
	m.PhysicalWriteAllowed = true
	m.ArtifactGroups[0].Artifacts[0].SHA256 = strings.Repeat("Z", 64)
	if _, err := BuildWritePlan(m); err == nil {
		t.Fatal("expected malformed SHA-256 to be rejected")
	}
}
