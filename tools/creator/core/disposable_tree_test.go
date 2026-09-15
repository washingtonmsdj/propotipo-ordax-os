package creatorcore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeStageableFixture(t *testing.T) (Manifest, string) {
	t.Helper()
	payloadRoot := t.TempDir()
	m := resolvedFixture(t, payloadRoot, []byte("disposable-tree-payload"))
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX" {
			m.ArtifactGroups[i].Artifacts[0].TargetPath = "/ordax/fixture/" + m.ArtifactGroups[i].ID + ".bin"
		} else {
			m.ArtifactGroups[i].Artifacts[0].TargetPath = "/EFI/fixture/" + m.ArtifactGroups[i].ID + ".bin"
		}
	}
	return m, payloadRoot
}

func assertDirectoryEmpty(t *testing.T, root string) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("directory %s is not empty after failed stage: %#v", root, entries)
	}
}

func TestStageDisposableTreeMapsExactlyTwoFilesystemRoots(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	outputRoot := t.TempDir()
	proof, err := StageDisposableTree(m, payloadRoot, outputRoot)
	if err != nil {
		t.Fatalf("StageDisposableTree: %v", err)
	}
	if proof.ArtifactCount != len(m.ArtifactGroups) {
		t.Fatalf("artifact count = %d, want %d", proof.ArtifactCount, len(m.ArtifactGroups))
	}
	if proof.RuntimeRootCount != len(m.RuntimeRootsCreatedEmpty) {
		t.Fatalf("runtime root count = %d, want %d", proof.RuntimeRootCount, len(m.RuntimeRootsCreatedEmpty))
	}
	entries, err := os.ReadDir(outputRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Name() != "ORDAX" || entries[1].Name() != "ORDAX-ESP" {
		t.Fatalf("unexpected disposable roots: %#v", entries)
	}
	for _, group := range m.ArtifactGroups {
		var staged string
		if group.Partition == "ORDAX" {
			staged = filepath.Join(outputRoot, "ORDAX", "fixture", group.ID+".bin")
		} else {
			staged = filepath.Join(outputRoot, "ORDAX-ESP", "EFI", "fixture", group.ID+".bin")
		}
		if _, err := os.Stat(staged); err != nil {
			t.Fatalf("missing staged artifact %s: %v", staged, err)
		}
	}
	for _, runtimeRoot := range []string{"releases", "state", "home"} {
		info, err := os.Stat(filepath.Join(outputRoot, "ORDAX", runtimeRoot))
		if err != nil || !info.IsDir() {
			t.Fatalf("missing runtime root %s: %v", runtimeRoot, err)
		}
	}
	if m.PhysicalWriteAllowed {
		t.Fatal("disposable tree fixture must remain physically unauthorized")
	}
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "not authorized") {
		t.Fatalf("physical plan must remain blocked after staging: %v", err)
	}
}

func TestStageDisposableTreeAllowsCanonicalOrdaxBootPathOnESP(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	changed := false
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX-ESP" {
			m.ArtifactGroups[i].Artifacts[0].TargetPath = "/ordax/vmlinuz"
			changed = true
			break
		}
	}
	if !changed {
		t.Fatal("fixture needs an ORDAX-ESP artifact group")
	}

	outputRoot := t.TempDir()
	if _, err := StageDisposableTree(m, payloadRoot, outputRoot); err != nil {
		t.Fatalf("StageDisposableTree with canonical ESP /ordax path: %v", err)
	}
	info, err := os.Stat(filepath.Join(outputRoot, "ORDAX-ESP", "ordax", "vmlinuz"))
	if err != nil || !info.Mode().IsRegular() {
		t.Fatalf("canonical ESP boot asset was not staged: info=%v err=%v", info, err)
	}
	if _, err := BuildWritePlan(m); err == nil || !strings.Contains(err.Error(), "not authorized") {
		t.Fatalf("allowing ESP /ordax staging must not authorize physical write: %v", err)
	}
}

func TestStageDisposableTreePublishesPreviouslyMissingOutputOnlyAfterSuccess(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	parent := t.TempDir()
	outputRoot := filepath.Join(parent, "published-stage")
	if _, err := os.Lstat(outputRoot); !os.IsNotExist(err) {
		t.Fatalf("output unexpectedly exists before stage: %v", err)
	}
	if _, err := StageDisposableTree(m, payloadRoot, outputRoot); err != nil {
		t.Fatalf("StageDisposableTree: %v", err)
	}
	entries, err := os.ReadDir(outputRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("published root count = %d, want 2", len(entries))
	}
}

func TestStageDisposableTreeFailurePublishesNoPartialBytes(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	ordaxGroups := make([]int, 0, 2)
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX" {
			ordaxGroups = append(ordaxGroups, i)
			if len(ordaxGroups) == 2 {
				break
			}
		}
	}
	if len(ordaxGroups) != 2 {
		t.Fatal("fixture needs at least two ORDAX artifact groups")
	}
	m.ArtifactGroups[ordaxGroups[0]].Artifacts[0].TargetPath = "/ordax/collision"
	m.ArtifactGroups[ordaxGroups[1]].Artifacts[0].TargetPath = "/ordax/collision/child.bin"

	outputRoot := t.TempDir()
	_, err := StageDisposableTree(m, payloadRoot, outputRoot)
	if err == nil || !strings.Contains(err.Error(), "create parent") {
		t.Fatalf("expected copy-time target collision, got %v", err)
	}
	assertDirectoryEmpty(t, outputRoot)

	stagingMatches, globErr := filepath.Glob(filepath.Join(filepath.Dir(outputRoot), "."+filepath.Base(outputRoot)+".stage-*"))
	if globErr != nil {
		t.Fatal(globErr)
	}
	if len(stagingMatches) != 0 {
		t.Fatalf("staging directories leaked after failure: %#v", stagingMatches)
	}
}

func TestStageDisposableTreePreflightFailureDoesNotCreateMissingOutput(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX" {
			m.ArtifactGroups[i].Artifacts[0].TargetPath = "/bootstrap/escape.bin"
			break
		}
	}
	parent := t.TempDir()
	outputRoot := filepath.Join(parent, "must-not-appear")
	_, err := StageDisposableTree(m, payloadRoot, outputRoot)
	if err == nil || !strings.Contains(err.Error(), "below /ordax") {
		t.Fatalf("unsafe ORDAX target error = %v", err)
	}
	if _, statErr := os.Lstat(outputRoot); !os.IsNotExist(statErr) {
		t.Fatalf("failed preflight published output path: %v", statErr)
	}
}

func TestStageDisposableTreeRejectsORDAXTargetOutsideRuntimeNamespace(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	for i := range m.ArtifactGroups {
		if m.ArtifactGroups[i].Partition == "ORDAX" {
			m.ArtifactGroups[i].Artifacts[0].TargetPath = "/bootstrap/escape.bin"
			break
		}
	}
	_, err := StageDisposableTree(m, payloadRoot, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "below /ordax") {
		t.Fatalf("unsafe ORDAX target error = %v", err)
	}
}

func TestStageDisposableTreeRejectsNonEmptyOutput(t *testing.T) {
	m, payloadRoot := makeStageableFixture(t)
	outputRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(outputRoot, "sentinel"), []byte("do-not-touch"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := StageDisposableTree(m, payloadRoot, outputRoot)
	if err == nil || !strings.Contains(err.Error(), "must be empty") {
		t.Fatalf("non-empty output error = %v", err)
	}
	data, readErr := os.ReadFile(filepath.Join(outputRoot, "sentinel"))
	if readErr != nil || string(data) != "do-not-touch" {
		t.Fatalf("sentinel changed: data=%q err=%v", string(data), readErr)
	}
}
