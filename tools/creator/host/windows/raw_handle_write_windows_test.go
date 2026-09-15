//go:build windows && ordax_raw_backend

package windowsadapter

import "testing"

// These tests must fail before CreateFileW. They exercise the tagged Windows
// writable boundary without ever opening a real PhysicalDrive on CI.
func TestWritablePhysicalDriveRejectsNilLeaseBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, nil); err == nil {
		t.Fatal("nil target-volume lease must block writable PhysicalDrive open")
	}
}

func TestWritablePhysicalDriveRejectsArbitraryLeaseBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, arbitraryRawVolumeLease{}); err == nil {
		t.Fatal("arbitrary lease implementation must block writable PhysicalDrive open")
	}
}

func TestWritablePhysicalDriveRejectsWrongDiskLeaseBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber + 1,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, lease); err == nil {
		t.Fatal("lease for another disk must block writable PhysicalDrive open")
	}
}

func TestWritablePhysicalDriveRejectsClosedLeaseBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
		closed:     true,
	}
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, lease); err == nil {
		t.Fatal("closed lease must block writable PhysicalDrive open")
	}
}

func TestWritablePhysicalDriveRejectsStaleTargetBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	target.PhysicalDiskBytes++
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, lease); err == nil {
		t.Fatal("stale target confirmation must block writable PhysicalDrive open")
	}
}

func TestWritablePhysicalDriveRejectsSystemDiskBeforeHostOpen(t *testing.T) {
	target := openedIdentityTarget()
	target.SystemDisk = true
	target.ConfirmationToken = ConfirmationToken(target)
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	if _, err := openVerifiedPhysicalDriveWritableUnbound(target, lease); err == nil {
		t.Fatal("Windows system disk must block writable PhysicalDrive open")
	}
}
