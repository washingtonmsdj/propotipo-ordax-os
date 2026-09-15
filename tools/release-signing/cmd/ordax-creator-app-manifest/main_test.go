package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestArtifact(t *testing.T, root string, body []byte) string {
	t.Helper()
	path := filepath.Join(root, artifactName)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestGenerateBindsExactSignedAppBytes(t *testing.T) {
	root := t.TempDir()
	body := []byte("authenticode-signed-creator-app-bytes")
	artifactPath := writeTestArtifact(t, root, body)
	manifestPath := filepath.Join(root, "creator-app-manifest.json")
	commit := "0123456789abcdef0123456789abcdef01234567"

	m, err := generate(artifactPath, manifestPath, commit, "0.1.0", 7)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	if m.Schema != manifestSchema || m.Purpose != purpose || m.SourceRepository != repository || m.CreatedFromRecipe != recipe {
		t.Fatalf("unexpected manifest identity: %+v", m)
	}
	if m.SourceCommit != commit || m.Version != "0.1.0" || m.ReleaseSequence != 7 {
		t.Fatalf("unexpected release identity: %+v", m)
	}
	if m.Artifact.Name != artifactName || m.Artifact.URL != artifactURL || m.Artifact.Size != int64(len(body)) || m.Artifact.SHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("unexpected artifact binding: %+v", m.Artifact)
	}

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var decoded manifest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded != m {
		t.Fatalf("disk manifest differs from generated manifest: disk=%+v generated=%+v", decoded, m)
	}
}

func TestGenerateIsByteDeterministic(t *testing.T) {
	body := []byte("same-final-signed-app")
	commit := "0123456789abcdef0123456789abcdef01234567"
	var first []byte
	for i := 0; i < 2; i++ {
		root := t.TempDir()
		artifactPath := writeTestArtifact(t, root, body)
		manifestPath := filepath.Join(root, "creator-app-manifest.json")
		if _, err := generate(artifactPath, manifestPath, commit, "1.2.3", 9); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = data
		} else if string(first) != string(data) {
			t.Fatal("same signed app bytes and identity produced different manifest bytes")
		}
	}
}

func TestGenerateRejectsWrongArtifactNameAndOverwrite(t *testing.T) {
	root := t.TempDir()
	wrong := filepath.Join(root, "renamed.exe")
	if err := os.WriteFile(wrong, []byte("bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "creator-app-manifest.json")
	commit := "0123456789abcdef0123456789abcdef01234567"
	if _, err := generate(wrong, manifestPath, commit, "0.1.0", 1); err == nil || !strings.Contains(err.Error(), "named") {
		t.Fatalf("wrong artifact name unexpectedly accepted: %v", err)
	}

	artifactPath := writeTestArtifact(t, root, []byte("final-signed-app"))
	if _, err := generate(artifactPath, manifestPath, commit, "0.1.0", 1); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := generate(artifactPath, manifestPath, commit, "0.1.1", 2); err == nil || !strings.Contains(err.Error(), "overwrite") {
		t.Fatalf("existing manifest unexpectedly overwritten: %v", err)
	}
	after, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(original) != string(after) {
		t.Fatal("existing manifest changed after refused overwrite")
	}
}

func TestGenerateRejectsInvalidReleaseIdentity(t *testing.T) {
	root := t.TempDir()
	artifactPath := writeTestArtifact(t, root, []byte("signed-app"))
	cases := []struct {
		commit   string
		version  string
		sequence int64
	}{
		{"bad", "0.1.0", 1},
		{"0123456789abcdef0123456789abcdef01234567", "bad version", 1},
		{"0123456789abcdef0123456789abcdef01234567", "0.1.0", 0},
	}
	for i, tc := range cases {
		out := filepath.Join(root, "invalid-"+string(rune('a'+i))+".json")
		if _, err := generate(artifactPath, out, tc.commit, tc.version, tc.sequence); err == nil {
			t.Fatalf("invalid release identity unexpectedly accepted: %+v", tc)
		}
		if _, err := os.Stat(out); !os.IsNotExist(err) {
			t.Fatalf("invalid release identity created output: %s", out)
		}
	}
}
