package creatorcore

import (
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
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "physical write blocked") {
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
	m, err := ParseManifest(canonicalManifestBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	m.PhysicalWriteAllowed = true
	m.AllArtifactsResolved = true
	for i := range m.ArtifactGroups {
		m.ArtifactGroups[i].Resolved = true
		m.ArtifactGroups[i].Artifacts = []Artifact{{
			SourcePath:   "out/example.bin",
			TargetPath:   "/example.bin",
			SHA256:       strings.Repeat("a", 64),
			Mode:         "0644",
			LogicalOwner: "test-owner",
			Reason:       "test fixture",
		}}
	}
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
}

func TestRejectsMalformedArtifactHash(t *testing.T) {
	m, err := ParseManifest(canonicalManifestBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	m.PhysicalWriteAllowed = true
	m.AllArtifactsResolved = true
	for i := range m.ArtifactGroups {
		m.ArtifactGroups[i].Resolved = true
		m.ArtifactGroups[i].Artifacts = []Artifact{{
			SourcePath: "x", TargetPath: "/x", SHA256: strings.Repeat("Z", 64), Mode: "0644", LogicalOwner: "x", Reason: "x",
		}}
	}
	if _, err := BuildWritePlan(m); err == nil {
		t.Fatal("expected malformed SHA-256 to be rejected")
	}
}
