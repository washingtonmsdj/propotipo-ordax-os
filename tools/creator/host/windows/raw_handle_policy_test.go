package windowsadapter

import "testing"

func openedIdentityTarget() Target {
	return FinalizeTarget(Target{
		DriveLetter:       "E:",
		VolumeLabel:       "ORDAX-USB",
		VolumeSerial:      0x10203040,
		DiskNumber:        6,
		VolumeBytes:       31 << 30,
		PhysicalDiskBytes: 32 << 30,
		DeviceRemovable:   true,
		DeviceSerial:      "USB-DEVICE-6",
	}, DriveTypeRemovable, true, BusTypeUSB, false)
}

func openedIdentityFor(target Target) openedPhysicalIdentity {
	return openedPhysicalIdentity{
		DiskNumber:        target.DiskNumber,
		PhysicalDiskBytes: target.PhysicalDiskBytes,
		BusType:           BusTypeUSB,
		DeviceRemovable:   target.DeviceRemovable,
		DeviceSerial:      target.DeviceSerial,
	}
}

func TestValidateExpectedPhysicalTargetAcceptsCurrentSafeUSB(t *testing.T) {
	target := openedIdentityTarget()
	if err := validateExpectedPhysicalTarget(target); err != nil {
		t.Fatal(err)
	}
}

func TestValidateExpectedPhysicalTargetRejectsStaleTokenBeforeOpen(t *testing.T) {
	target := openedIdentityTarget()
	target.PhysicalDiskBytes++
	if err := validateExpectedPhysicalTarget(target); err == nil {
		t.Fatal("Target changed after confirmation must be rejected before PhysicalDrive open")
	}
}

func TestValidateExpectedPhysicalTargetRejectsNonUSBIdentity(t *testing.T) {
	target := openedIdentityTarget()
	target.BusType = "other"
	target.ConfirmationToken = ConfirmationToken(target)
	if err := validateExpectedPhysicalTarget(target); err == nil {
		t.Fatal("non-USB target identity must be rejected before PhysicalDrive open")
	}
}

func TestValidateExpectedPhysicalTargetRejectsSystemDisk(t *testing.T) {
	target := openedIdentityTarget()
	target.SystemDisk = true
	target.ConfirmationToken = ConfirmationToken(target)
	if err := validateExpectedPhysicalTarget(target); err == nil {
		t.Fatal("Windows system disk must be rejected before PhysicalDrive open")
	}
}

func TestValidateOpenedPhysicalIdentityAcceptsExactConfirmedDisk(t *testing.T) {
	target := openedIdentityTarget()
	if err := validateOpenedPhysicalIdentity(target, openedIdentityFor(target)); err != nil {
		t.Fatal(err)
	}
}

func TestValidateOpenedPhysicalIdentityRejectsDiskNumberSwap(t *testing.T) {
	target := openedIdentityTarget()
	actual := openedIdentityFor(target)
	actual.DiskNumber++
	if err := validateOpenedPhysicalIdentity(target, actual); err == nil {
		t.Fatal("different opened PhysicalDrive number must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsNonUSBHandle(t *testing.T) {
	target := openedIdentityTarget()
	actual := openedIdentityFor(target)
	actual.BusType = 11
	if err := validateOpenedPhysicalIdentity(target, actual); err == nil {
		t.Fatal("opened non-USB handle must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsCapacityChange(t *testing.T) {
	target := openedIdentityTarget()
	actual := openedIdentityFor(target)
	actual.PhysicalDiskBytes++
	if err := validateOpenedPhysicalIdentity(target, actual); err == nil {
		t.Fatal("opened capacity change must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsSerialChange(t *testing.T) {
	target := openedIdentityTarget()
	actual := openedIdentityFor(target)
	actual.DeviceSerial = "DIFFERENT-USB"
	if err := validateOpenedPhysicalIdentity(target, actual); err == nil {
		t.Fatal("opened device serial change must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsRemovableFlagChange(t *testing.T) {
	target := openedIdentityTarget()
	actual := openedIdentityFor(target)
	actual.DeviceRemovable = !actual.DeviceRemovable
	if err := validateOpenedPhysicalIdentity(target, actual); err == nil {
		t.Fatal("opened removable identity change must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsStaleTargetToken(t *testing.T) {
	target := openedIdentityTarget()
	target.PhysicalDiskBytes++
	if err := validateOpenedPhysicalIdentity(target, openedIdentityFor(target)); err == nil {
		t.Fatal("Target changed after confirmation must be rejected")
	}
}

func TestValidateOpenedPhysicalIdentityRejectsSystemDisk(t *testing.T) {
	target := openedIdentityTarget()
	target.SystemDisk = true
	target.ConfirmationToken = ConfirmationToken(target)
	if err := validateOpenedPhysicalIdentity(target, openedIdentityFor(target)); err == nil {
		t.Fatal("Windows system disk must always be rejected")
	}
}
