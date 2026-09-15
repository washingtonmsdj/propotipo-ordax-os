//go:build windows

package windowsadapter

import (
	"os"
	"testing"
)

func TestOpenVerifiedRawImageForApplyDeniesConcurrentWindowsWriter(t *testing.T) {
	fixture := writeRawFixture(t, []byte("windows share denial"))
	file, _, err := openVerifiedRawImageForApply(fixture.Path, fixture.SHA256, fixture.SizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	writer, err := os.OpenFile(fixture.Path, os.O_WRONLY, 0)
	if err == nil {
		_ = writer.Close()
		t.Fatal("verified raw image handle must deny concurrent write access on Windows")
	}
}
