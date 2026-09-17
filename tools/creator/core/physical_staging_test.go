package creatorcore

import (
	"os"
	"testing"
)

func TestConfigurePhysicalImageStaging(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "ordax-staging-*")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := configurePhysicalImageStaging(file); err != nil {
		t.Fatalf("configure staging: %v", err)
	}
}
