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

func TestConfirmationTokenIsDeterministicAndIdentitySensitive(t *testing.T) {
	base := Target{
		DriveLetter:  "E:",
		VolumeLabel:  "USB",
		VolumeSerial: 0x1234abcd,
		DiskNumber:   7,
		VolumeBytes:  32 << 30,
		DriveType:    "removable",
	}
	first := ConfirmationToken(base)
	second := ConfirmationToken(base)
	if first == "" || first != second || len(first) != 64 {
		t.Fatalf("unexpected confirmation token %q / %q", first, second)
	}
	changed := base
	changed.DiskNumber++
	if ConfirmationToken(changed) == first {
		t.Fatal("disk-number change must change confirmation token")
	}
	changed = base
	changed.VolumeSerial++
	if ConfirmationToken(changed) == first {
		t.Fatal("volume-serial change must change confirmation token")
	}
	changed = base
	changed.VolumeBytes++
	if ConfirmationToken(changed) == first {
		t.Fatal("volume-size change must change confirmation token")
	}
}

func TestFinalizeTargetBindsSafetyAndToken(t *testing.T) {
	target := FinalizeTarget(Target{
		DriveLetter:  "F:",
		VolumeSerial: 42,
		DiskNumber:   4,
		VolumeBytes:  16 << 30,
		DriveType:    "removable",
	}, DriveTypeRemovable, true)
	if !target.PrototypeSafe {
		t.Fatal("expected removable target to be prototype-safe")
	}
	if target.ConfirmationToken != ConfirmationToken(target) {
		t.Fatal("finalized target confirmation token mismatch")
	}
}

func TestMatchConfirmedTargetRequiresCurrentSafeIdentity(t *testing.T) {
	target := FinalizeTarget(Target{
		DriveLetter:  "G:",
		VolumeSerial: 99,
		DiskNumber:   8,
		VolumeBytes:  64 << 30,
		DriveType:    "removable",
	}, DriveTypeRemovable, true)
	matched, err := MatchConfirmedTarget([]Target{target}, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	if matched.DiskNumber != target.DiskNumber || matched.VolumeSerial != target.VolumeSerial {
		t.Fatalf("matched wrong target: %#v", matched)
	}

	changed := target
	changed.DiskNumber++
	changed.ConfirmationToken = ConfirmationToken(changed)
	if _, err := MatchConfirmedTarget([]Target{changed}, target.ConfirmationToken); err == nil {
		t.Fatal("stale token must not confirm a changed physical-disk mapping")
	}

	unsafeTarget := target
	unsafeTarget.PrototypeSafe = false
	if _, err := MatchConfirmedTarget([]Target{unsafeTarget}, target.ConfirmationToken); err == nil {
		t.Fatal("unsafe target must not be confirmable")
	}

	if _, err := MatchConfirmedTarget([]Target{target}, "not-a-token"); err == nil {
		t.Fatal("malformed token must be rejected")
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
