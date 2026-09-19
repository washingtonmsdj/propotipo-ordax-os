package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validComponentManifestBytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.runtime-component-release/1",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "component_id": "internet",
  "version": "0.3.0",
  "release_sequence": 3,
  "created_from_ci_recipe": "runtime-component/internet/1",
  "package": {
    "name": "internet.zip",
    "url": "https://example.invalid/runtime-components/internet.zip",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "size": 123
  }
}
`)
}

func writeComponentManifestForTest(t *testing.T, root string, data []byte) string {
	t.Helper()
	path := filepath.Join(root, "component-release.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSignComponentRoundTripPreservesExactPayload(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	manifestBytes := append([]byte("\n  "), validComponentManifestBytes()...)
	manifestBytes = append(manifestBytes, '\n')
	manifestPath := writeComponentManifestForTest(t, root, manifestBytes)
	envelopePath := filepath.Join(root, "component-envelope.json")

	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifest, err := signComponentManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
		"internet",
	)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ComponentID != "internet" || manifest.Version != "0.3.0" || manifest.ReleaseSequence != 3 {
		t.Fatalf("unexpected signed component identity: %#v", manifest)
	}

	data, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != componentEnvelopeSchema || envelope.KeyID != "prototype-1" {
		t.Fatalf("unexpected component envelope: %#v", envelope)
	}
	if string(envelope.Payload) != string(manifestBytes) {
		t.Fatal("component signer changed exact manifest bytes")
	}

	verified, err := verifyComponentEnvelopeFile(
		envelopePath,
		trustPath,
		defaultRepo,
		"internet",
	)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SourceCommit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("unexpected verified source commit: %s", verified.SourceCommit)
	}
}

func TestComponentSignerRejectsWrongComponentAndTrust(t *testing.T) {
	root := t.TempDir()
	privateA := filepath.Join(root, "a.pem")
	trustA := filepath.Join(root, "a.json")
	privateB := filepath.Join(root, "b.pem")
	trustB := filepath.Join(root, "b.json")
	manifestPath := writeComponentManifestForTest(t, root, validComponentManifestBytes())

	if _, err := generateKeyFiles(privateA, trustA, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privateB, trustB, "prototype-1"); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "wrong-component.json")
	if _, err := signComponentManifest(
		manifestPath,
		privateA,
		trustA,
		output,
		"prototype-1",
		defaultRepo,
		"notes",
	); err == nil || !strings.Contains(err.Error(), "id mismatch") {
		t.Fatalf("wrong component error = %v", err)
	}

	output = filepath.Join(root, "wrong-trust.json")
	if _, err := signComponentManifest(
		manifestPath,
		privateA,
		trustB,
		output,
		"prototype-1",
		defaultRepo,
		"internet",
	); err == nil || !strings.Contains(err.Error(), "does not match supplied trust anchor") {
		t.Fatalf("wrong trust error = %v", err)
	}
}

func TestComponentSignerRejectsUnsafePackagePolicy(t *testing.T) {
	var manifest ComponentReleaseManifest
	if err := json.Unmarshal(validComponentManifestBytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Package.URL = "http://example.invalid/internet.zip"
	data, _ := json.Marshal(manifest)
	if _, err := strictComponentManifest(data, defaultRepo, "internet"); err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("unsafe URL error = %v", err)
	}

	manifest.Package.URL = "https://example.invalid/internet.zip"
	manifest.Package.Name = "notes.zip"
	data, _ = json.Marshal(manifest)
	if _, err := strictComponentManifest(data, defaultRepo, "internet"); err == nil || !strings.Contains(err.Error(), "package name") {
		t.Fatalf("package name error = %v", err)
	}

	manifest.Package.Name = "internet.zip"
	manifest.ReleaseSequence = 0
	data, _ = json.Marshal(manifest)
	if _, err := strictComponentManifest(data, defaultRepo, "internet"); err == nil || !strings.Contains(err.Error(), "release_sequence") {
		t.Fatalf("release sequence error = %v", err)
	}
}
