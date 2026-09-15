package windowsadapter

import (
	"os"
	"strings"
	"testing"
)

func TestPrototypeCandidateRequiresMappedRemovableVolume(t *testing.T) {
	if !IsPrototypeCandidate("E:", DriveTypeRemovable, true) {
		t.Fatal("expected mapped removable E: to be accepted")
	}
	if IsPrototypeCandidate("E:", 3, true) {
		t.Fatal("fixed-media volume must not be accepted by prototype policy")
	}
	if IsPrototypeCandidate("E:", DriveTypeRemovable, false) {
		t.Fatal("unmapped volume must not be accepted")
	}
	if IsPrototypeCandidate("C:", DriveTypeRemovable, true) {
		t.Fatal("system drive letter must never be accepted")
	}
	if IsPrototypeCandidate("invalid", DriveTypeRemovable, true) {
		t.Fatal("invalid drive letter must not be accepted")
	}
}

func TestWindowsDiscoverySourceContainsNoWritePrimitive(t *testing.T) {
	data, err := os.ReadFile("targets_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, forbidden := range []string{
		"GENERIC_WRITE",
		"WriteFile",
		"IOCTL_DISK_SET_",
		"FSCTL_LOCK_VOLUME",
		"FSCTL_DISMOUNT_VOLUME",
		"CREATE_ALWAYS",
		"TRUNCATE_EXISTING",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("read-only discovery unexpectedly contains %q", forbidden)
		}
	}
}
