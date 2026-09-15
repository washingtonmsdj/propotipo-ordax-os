package update

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validManifestForTest() Manifest {
	return Manifest{
		Schema:       ChannelSchema,
		Channel:      DevelopmentChannel,
		Version:      "dev-0123456789ab",
		SourceCommit: "0123456789abcdef0123456789abcdef01234567",
		Payload: Payload{
			URL:    "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/ordax-creator-dev-windows-amd64.zip",
			SHA256: strings.Repeat("a", 64),
			Size:   1234,
		},
		Entrypoints: Entrypoints{
			Inspect: "1-Inspect-OrdaXUSB.cmd",
			Trust:   "2-Initialize-OrdaXTrust.cmd",
			Status:  "ordax-creator-physical-test.exe",
		},
	}
}

func TestValidateManifestAcceptsBoundDevelopmentChannel(t *testing.T) {
	if err := ValidateManifest(validManifestForTest()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateManifestRejectsExternalPayload(t *testing.T) {
	m := validManifestForTest()
	m.Payload.URL = "https://example.invalid/creator.zip"
	if err := ValidateManifest(m); err == nil {
		t.Fatal("external payload URL unexpectedly accepted")
	}
}

func TestValidateManifestRejectsTraversalEntrypoint(t *testing.T) {
	m := validManifestForTest()
	m.Entrypoints.Trust = "../evil.cmd"
	if err := ValidateManifest(m); err == nil {
		t.Fatal("path traversal entrypoint unexpectedly accepted")
	}
}

func writeZip(t *testing.T, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "payload.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, body := range entries {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractPayloadRequiresAllEntrypoints(t *testing.T) {
	m := validManifestForTest()
	zipPath := writeZip(t, map[string]string{
		m.Entrypoints.Inspect: "@echo inspect\r\n",
		m.Entrypoints.Trust:   "@echo trust\r\n",
	})
	dest := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(zipPath, dest, m); err == nil || !strings.Contains(err.Error(), "status entrypoint") {
		t.Fatalf("missing status entrypoint error = %v", err)
	}
}

func TestExtractPayloadRejectsTraversal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.zip")
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	entry, err := archive.Create("../evil.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("evil"))
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "out")
	if err := os.Mkdir(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractPayload(path, dest, validManifestForTest()); err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("traversal error = %v", err)
	}
}
