package main

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func makeSourceTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	system := filepath.Join(root, "system")
	if err := os.Mkdir(system, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(system, "entrypoint"), []byte("#!/bin/sh\necho release\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(system, "version"), []byte("test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestBundleIsDeterministic(t *testing.T) {
	root := makeSourceTree(t)
	out1 := filepath.Join(t.TempDir(), "one.tar")
	out2 := filepath.Join(t.TempDir(), "two.tar")
	hash1, size1, err := writeBundle(root, out1)
	if err != nil {
		t.Fatal(err)
	}
	hash2, size2, err := writeBundle(root, out2)
	if err != nil {
		t.Fatal(err)
	}
	if hash1 != hash2 || size1 != size2 {
		t.Fatalf("bundle identity changed: %s/%d vs %s/%d", hash1, size1, hash2, size2)
	}
	one, _ := os.ReadFile(out1)
	two, _ := os.ReadFile(out2)
	if !bytes.Equal(one, two) {
		t.Fatal("deterministic builds differ byte-for-byte")
	}
}

func TestBundleHeadersAreNormalizedAndBootable(t *testing.T) {
	root := makeSourceTree(t)
	out := filepath.Join(t.TempDir(), "system.tar")
	if _, _, err := writeBundle(root, out); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	reader := tar.NewReader(file)
	seenEntrypoint := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Uid != 0 || header.Gid != 0 || header.Uname != "" || header.Gname != "" {
			t.Fatalf("non-normalized ownership for %s", header.Name)
		}
		if !header.ModTime.Equal(time.Unix(0, 0).UTC()) {
			t.Fatalf("non-normalized mtime for %s: %s", header.Name, header.ModTime)
		}
		if header.Name == "system/entrypoint" {
			seenEntrypoint = true
			if header.Mode != 0o755 || header.Size == 0 || header.Typeflag != tar.TypeReg {
				t.Fatalf("entrypoint header is not bootable: %#v", header)
			}
		}
	}
	if !seenEntrypoint {
		t.Fatal("system/entrypoint missing from bundle")
	}
}

func TestMissingEntrypointIsRejected(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "system"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "system", "version"), []byte("test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writeBundle(root, filepath.Join(t.TempDir(), "system.tar")); err == nil {
		t.Fatal("system without entrypoint was bundled")
	}
}

func TestSymlinkIsRejected(t *testing.T) {
	root := makeSourceTree(t)
	link := filepath.Join(root, "system", "link")
	if err := os.Symlink("version", link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if _, _, err := writeBundle(root, filepath.Join(t.TempDir(), "system.tar")); err == nil {
		t.Fatal("symlink source was bundled")
	}
}

func TestLooseModeIsRejectedOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode semantics do not apply")
	}
	root := makeSourceTree(t)
	if err := os.Chmod(filepath.Join(root, "system", "version"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writeBundle(root, filepath.Join(t.TempDir(), "system.tar")); err == nil {
		t.Fatal("file with non-canonical mode was bundled")
	}
}

func TestOverwriteIsRejected(t *testing.T) {
	root := makeSourceTree(t)
	out := filepath.Join(t.TempDir(), "system.tar")
	if err := os.WriteFile(out, []byte("sentinel"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writeBundle(root, out); err == nil {
		t.Fatal("existing output was overwritten")
	}
	data, _ := os.ReadFile(out)
	if string(data) != "sentinel" {
		t.Fatal("existing output changed")
	}
}

func TestOutputInsideSystemTreeIsRejected(t *testing.T) {
	root := makeSourceTree(t)
	out := filepath.Join(root, "system", "system.tar")
	if _, _, err := writeBundle(root, out); err == nil {
		t.Fatal("output inside source tree was accepted")
	}
}
