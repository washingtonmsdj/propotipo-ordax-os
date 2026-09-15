//go:build windows && ordax_raw_backend

package windowsadapter

import "testing"

func TestWindowsRawDiskRuntimeElevationProbeIsCallable(t *testing.T) {
	if _, err := (windowsRawDiskRuntimeUnbound{}).IsElevated(); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsRawDiskRuntimeRejectsStaleLeaseRequestBeforeLock(t *testing.T) {
	target := openedIdentityTarget()
	target.PhysicalDiskBytes++
	if _, err := (windowsRawDiskRuntimeUnbound{}).AcquireTargetVolumeLease(target); err == nil {
		t.Fatal("stale target must be rejected before native volume lock acquisition")
	}
}

func TestWindowsRawDiskRuntimeRejectsWritableOpenWithoutManagedLease(t *testing.T) {
	target := openedIdentityTarget()
	if _, err := (windowsRawDiskRuntimeUnbound{}).OpenVerifiedPhysicalDrive(target, nil); err == nil {
		t.Fatal("native writable PhysicalDrive open must reject missing managed lease before host open")
	}
}
