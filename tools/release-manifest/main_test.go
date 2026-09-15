package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

const testCommit = "0123456789abcdef0123456789abcdef01234567"

func makeArtifact(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "system.tar")
	if err := os.WriteFile(path, []byte("deterministic-system-tar\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBuildManifestPinsArtifactIdentity(t *testing.T) {
	artifact := makeArtifact(t)
	manifest, err := buildManifest(artifact, testCommit, "https://example.invalid/system.tar", defaultRepo, defaultRecipe)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(artifact)
	digest := sha256.Sum256(data)
	if manifest.Schema != manifestSchema || manifest.SourceCommit != testCommit || manifest.ReleaseID != testCommit {
		t.Fatalf("unexpected manifest identity: %#v", manifest)
	}
	if len(manifest.Artifacts) != 1 {
		t.Fatalf("artifact count = %d", len(manifest.Artifacts))
	}
	got := manifest.Artifacts[0]
	if got.Name != "system.tar" || got.Role != "system" || got.Size != int64(len(data)) || got.SHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("unexpected artifact identity: %#v", got)
	}
}

func TestManifestOutputIsDeterministic(t *testing.T) {
	manifest, err := buildManifest(makeArtifact(t), testCommit, "https://example.invalid/system.tar", defaultRepo, defaultRecipe)
	if err != nil {
		t.Fatal(err)
	}
	outA := filepath.Join(t.TempDir(), "a.json")
	outB := filepath.Join(t.TempDir(), "b.json")
	if err := writeManifest(outA, manifest); err != nil {
		t.Fatal(err)
	}
	if err := writeManifest(outB, manifest); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(outA)
	b, _ := os.ReadFile(outB)
	if !bytes.Equal(a, b) {
		t.Fatal("manifest JSON changed between identical writes")
	}
	var decoded Manifest
	if err := json.Unmarshal(a, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.SourceCommit != testCommit {
		t.Fatal("written manifest lost source commit")
	}
}

func TestNonHTTPSArtifactURLIsRejected(t *testing.T) {
	if _, err := buildManifest(makeArtifact(t), testCommit, "http://example.invalid/system.tar", defaultRepo, defaultRecipe); err == nil {
		t.Fatal("non-HTTPS artifact URL was accepted")
	}
}

func TestInvalidSourceCommitIsRejected(t *testing.T) {
	if _, err := buildManifest(makeArtifact(t), "ABC", "https://example.invalid/system.tar", defaultRepo, defaultRecipe); err == nil {
		t.Fatal("invalid source commit was accepted")
	}
}

func TestArtifactMustBeNamedSystemTar(t *testing.T) {
	path := filepath.Join(t.TempDir(), "other.tar")
	if err := os.WriteFile(path, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := buildManifest(path, testCommit, "https://example.invalid/system.tar", defaultRepo, defaultRecipe); err == nil {
		t.Fatal("non-canonical artifact filename was accepted")
	}
}

func TestArtifactSymlinkIsRejected(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "real.tar")
	if err := os.WriteFile(real, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "system.tar")
	if err := os.Symlink(real, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if _, err := buildManifest(link, testCommit, "https://example.invalid/system.tar", defaultRepo, defaultRecipe); err == nil {
		t.Fatal("symlink artifact was accepted")
	}
}

func TestOutputOverwriteIsRejected(t *testing.T) {
	manifest, err := buildManifest(makeArtifact(t), testCommit, "https://example.invalid/system.tar", defaultRepo, defaultRecipe)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "release-manifest.json")
	if err := os.WriteFile(out, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeManifest(out, manifest); err == nil {
		t.Fatal("existing manifest output was overwritten")
	}
	data, _ := os.ReadFile(out)
	if string(data) != "sentinel" {
		t.Fatal("existing output changed")
	}
}
