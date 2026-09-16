//go:build windows && ordax_raw_backend

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateApplySidecarPathRequiresPreparedImageDirectory(t *testing.T) {
	dir := t.TempDir()
	image := filepath.Join(dir, "ordax-prepared.raw")
	if err := os.WriteFile(image, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	valid := filepath.Join(dir, "ordax-physical-progress.json")
	resolved, err := validateApplySidecarPath(image, valid, "ordax-physical-progress.json")
	if err != nil {
		t.Fatalf("valid sidecar rejected: %v", err)
	}
	if filepath.Clean(resolved) != filepath.Clean(valid) {
		t.Fatalf("resolved=%q want=%q", resolved, valid)
	}

	outside := filepath.Join(t.TempDir(), "ordax-physical-progress.json")
	if _, err := validateApplySidecarPath(image, outside, "ordax-physical-progress.json"); err == nil {
		t.Fatal("sidecar outside prepared image directory must be rejected")
	}
}

func TestValidateApplySidecarPathRequiresExpectedName(t *testing.T) {
	dir := t.TempDir()
	image := filepath.Join(dir, "ordax-prepared.raw")
	if err := os.WriteFile(image, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := validateApplySidecarPath(image, filepath.Join(dir, "other.txt"), "ordax-physical-error.txt"); err == nil {
		t.Fatal("unexpected sidecar basename must be rejected")
	}
}
