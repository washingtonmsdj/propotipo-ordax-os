package update

import (
	"encoding/json"
	"strings"
	"testing"
)

func validApplicationManifestForTest() ApplicationManifest {
	return ApplicationManifest{
		Schema:       ApplicationSchema,
		Channel:      DevelopmentChannel,
		Version:      "dev-0123456789ab",
		SourceCommit: "0123456789abcdef0123456789abcdef01234567",
		URL:          "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-dev/OrdaX-Creator.exe",
		SHA256:       strings.Repeat("a", 64),
		Size:         7_000_000,
	}
}

func TestValidateApplicationManifestAcceptsCanonicalDevelopmentApp(t *testing.T) {
	if err := ValidateApplicationManifest(validApplicationManifestForTest()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateApplicationManifestRejectsExternalExecutable(t *testing.T) {
	value := validApplicationManifestForTest()
	value.URL = "https://example.invalid/OrdaX-Creator.exe"
	if err := ValidateApplicationManifest(value); err == nil {
		t.Fatal("external application URL unexpectedly accepted")
	}
}

func TestValidateApplicationManifestRejectsOversizedExecutable(t *testing.T) {
	value := validApplicationManifestForTest()
	value.Size = maxApplicationBytes + 1
	if err := ValidateApplicationManifest(value); err == nil {
		t.Fatal("oversized application unexpectedly accepted")
	}
}

func TestDecodeApplicationManifestRejectsUnknownFields(t *testing.T) {
	value := validApplicationManifestForTest()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data[:len(data)-1], []byte(`,"unexpected":true}`)...)
	if _, err := decodeApplicationManifest(data); err == nil {
		t.Fatal("application manifest with unknown field unexpectedly accepted")
	}
}
