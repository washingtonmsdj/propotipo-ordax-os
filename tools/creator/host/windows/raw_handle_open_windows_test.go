//go:build windows

package windowsadapter

import "testing"

// These tests deliberately fail at the host-neutral pre-open policy boundary.
// They therefore exercise the Windows-only open path without ever calling
// CreateFileW for a real PhysicalDrive on the CI runner.
func TestOpenVerifiedPhysicalDriveReadOnlyRejectsStaleTargetBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	target.PhysicalDiskBytes++

	if _, err := openVerifiedPhysicalDriveReadOnly(target); err == nil {
		t.Fatal("stale target must be rejected before PhysicalDrive host open")
	}
}

func TestOpenVerifiedPhysicalDriveReadOnlyRejectsSystemDiskBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	target.SystemDisk = true
	target.ConfirmationToken = ConfirmationToken(target)

	if _, err := openVerifiedPhysicalDriveReadOnly(target); err == nil {
		t.Fatal("Windows system disk must be rejected before PhysicalDrive host open")
	}
}

func TestOpenVerifiedPhysicalDriveReadOnlyRejectsNonUSBBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	target.BusType = "other"
	target.ConfirmationToken = ConfirmationToken(target)

	if _, err := openVerifiedPhysicalDriveReadOnly(target); err == nil {
		t.Fatal("non-USB identity must be rejected before PhysicalDrive host open")
	}
}
