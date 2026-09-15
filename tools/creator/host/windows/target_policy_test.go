package windowsadapter

import (
	"os"
	"strings"
	"testing"
)

func TestPrototypeCandidateRequiresUSBAndRejectsSystemDisk(t *testing.T) {
	if !IsPrototypeCandidate("E:", DriveTypeRemovable, true, BusTypeUSB, false) {
		t.Fatal("expected mapped removable USB E: to be accepted")
	}
	if !IsPrototypeCandidate("F:", DriveTypeFixed, true, BusTypeUSB, false) {
		t.Fatal("expected mapped fixed-media USB F: to be accepted")
	}
	if IsPrototypeCandidate("F:", DriveTypeFixed, true, 11, false) {
		t.Fatal("fixed SATA media must not be accepted")
	}
	if IsPrototypeCandidate("E:", DriveTypeRemovable, true, 0, false) {
		t.Fatal("removable media without proven USB transport must not be accepted")
	}
	if IsPrototypeCandidate("E:", DriveTypeRemovable, false, BusTypeUSB, false) {
		t.Fatal("unmapped volume must not be accepted")
	}
	if IsPrototypeCandidate("E:", DriveTypeRemovable, true, BusTypeUSB, true) {
		t.Fatal("physical disk hosting Windows must never be accepted")
	}
	if IsPrototypeCandidate("C:", DriveTypeRemovable, true, BusTypeUSB, false) {
		t.Fatal("system drive letter must never be accepted")
	}
	if IsPrototypeCandidate("invalid", DriveTypeRemovable, true, BusTypeUSB, false) {
		t.Fatal("invalid drive letter must not be accepted")
	}
}

func TestConfirmationTokenIsDeterministicAndIdentitySensitive(t *testing.T) {
	base := FinalizeTarget(Target{
		DriveLetter:       "E:",
		VolumeLabel:       "USB",
		VolumeSerial:      0x1234abcd,
		DiskNumber:        7,
		VolumeBytes:       30 << 30,
		PhysicalDiskBytes: 32 << 30,
		DeviceRemovable:   true,
		DeviceSerial:      "DEVICE-123",
	}, DriveTypeRemovable, true, BusTypeUSB, false)
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
	changed = base
	changed.PhysicalDiskBytes++
	if ConfirmationToken(changed) == first {
		t.Fatal("physical-disk-size change must change confirmation token")
	}
	changed = base
	changed.DeviceSerial = "DEVICE-456"
	if ConfirmationToken(changed) == first {
		t.Fatal("device-serial change must change confirmation token")
	}
	changed = base
	changed.BusType = "other"
	if ConfirmationToken(changed) == first {
		t.Fatal("bus-type change must change confirmation token")
	}
}

func TestFinalizeTargetBindsUSBTransportCapacitySafetyAndToken(t *testing.T) {
	target := FinalizeTarget(Target{
		DriveLetter:       "F:",
		VolumeSerial:      42,
		DiskNumber:        4,
		VolumeBytes:       15 << 30,
		PhysicalDiskBytes: 16 << 30,
		DeviceRemovable:   false,
		DeviceSerial:      "SSD-USB",
	}, DriveTypeFixed, true, BusTypeUSB, false)
	if !target.PrototypeSafe {
		t.Fatal("expected fixed-media USB target with measured capacity to be prototype-safe")
	}
	if target.DriveType != "fixed" || target.BusType != "usb" || target.SystemDisk {
		t.Fatalf("unexpected finalized identity: %#v", target)
	}
	if target.ConfirmationToken != ConfirmationToken(target) {
		t.Fatal("finalized target confirmation token mismatch")
	}

	missingCapacity := target
	missingCapacity.PhysicalDiskBytes = 0
	missingCapacity = FinalizeTarget(missingCapacity, DriveTypeFixed, true, BusTypeUSB, false)
	if missingCapacity.PrototypeSafe {
		t.Fatal("target without measured physical capacity must not be prototype-safe")
	}
}

func TestMatchConfirmedTargetRequiresCurrentSafeIdentity(t *testing.T) {
	target := FinalizeTarget(Target{
		DriveLetter:       "G:",
		VolumeSerial:      99,
		DiskNumber:        8,
		VolumeBytes:       62 << 30,
		PhysicalDiskBytes: 64 << 30,
		DeviceRemovable:   true,
		DeviceSerial:      "USB-99",
	}, DriveTypeRemovable, true, BusTypeUSB, false)
	matched, err := MatchConfirmedTarget([]Target{target}, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	if matched.DiskNumber != target.DiskNumber || matched.PhysicalDiskBytes != target.PhysicalDiskBytes {
		t.Fatalf("matched wrong target: %#v", matched)
	}

	changed := target
	changed.DiskNumber++
	changed.ConfirmationToken = ConfirmationToken(changed)
	if _, err := MatchConfirmedTarget([]Target{changed}, target.ConfirmationToken); err == nil {
		t.Fatal("stale token must not confirm a changed physical-disk mapping")
	}

	tampered := target
	tampered.DiskNumber++
	if _, err := MatchConfirmedTarget([]Target{tampered}, target.ConfirmationToken); err == nil {
		t.Fatal("stored token must not confirm a Target whose identity fields changed")
	}

	unsafeTarget := target
	unsafeTarget.PrototypeSafe = false
	if _, err := MatchConfirmedTarget([]Target{unsafeTarget}, target.ConfirmationToken); err == nil {
		t.Fatal("unsafe target must not be confirmable")
	}

	if _, err := MatchConfirmedTarget([]Target{target}, "not-a-token"); err == nil {
		t.Fatal("malformed token must be rejected")
	}
	if _, err := MatchConfirmedTarget([]Target{target}, strings.ToUpper(target.ConfirmationToken)); err == nil {
		t.Fatal("uppercase token must be rejected instead of silently normalized")
	}
}

func TestWindowsDiscoverySourceRequiresUSBDescriptorPhysicalCapacityAndSystemDiskGuard(t *testing.T) {
	data, err := os.ReadFile("targets_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, required := range []string{
		"ioctlStorageQueryProperty",
		"ioctlDiskGetDriveGeometryEx",
		"PhysicalDiskBytes",
		"BusTypeUSB",
		"procGetWindowsDirectoryW",
		"windowsSystemDiskNumber",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("read-only discovery is missing safety evidence %q", required)
		}
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
