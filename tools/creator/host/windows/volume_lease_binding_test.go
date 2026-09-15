package windowsadapter

import "testing"

type inertLeaseHandle struct{}

func (inertLeaseHandle) DiskNumbers() ([]uint32, error) { return []uint32{8}, nil }
func (inertLeaseHandle) Dismount() error                { return nil }
func (inertLeaseHandle) Close() error                   { return nil }

type arbitraryRawVolumeLease struct{}

func (arbitraryRawVolumeLease) Close() error { return nil }

func TestValidateManagedTargetVolumeLeaseAcceptsSameDiskActiveLease(t *testing.T) {
	target := openedIdentityTarget()
	target.DiskNumber = 8
	target.ConfirmationToken = ConfirmationToken(target)
	lease := &managedTargetVolumeLease{
		diskNumber: 8,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	got, err := validateManagedTargetVolumeLease(target, lease)
	if err != nil {
		t.Fatal(err)
	}
	if got != lease {
		t.Fatal("validated lease identity changed")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsNilLease(t *testing.T) {
	target := openedIdentityTarget()
	if _, err := validateManagedTargetVolumeLease(target, nil); err == nil {
		t.Fatal("nil lease must be rejected")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsArbitraryLeaseImplementation(t *testing.T) {
	target := openedIdentityTarget()
	if _, err := validateManagedTargetVolumeLease(target, arbitraryRawVolumeLease{}); err == nil {
		t.Fatal("arbitrary rawVolumeLease implementation must be rejected")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsClosedLease(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
		closed:     true,
	}
	if _, err := validateManagedTargetVolumeLease(target, lease); err == nil {
		t.Fatal("closed managed lease must be rejected")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsDifferentDisk(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber + 1,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	if _, err := validateManagedTargetVolumeLease(target, lease); err == nil {
		t.Fatal("lease for a different PhysicalDrive must be rejected")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsEmptyLease(t *testing.T) {
	target := openedIdentityTarget()
	lease := &managedTargetVolumeLease{diskNumber: target.DiskNumber}
	if _, err := validateManagedTargetVolumeLease(target, lease); err == nil {
		t.Fatal("managed lease without locked volumes must be rejected")
	}
}

func TestValidateManagedTargetVolumeLeaseRejectsStaleTargetBeforeLease(t *testing.T) {
	target := openedIdentityTarget()
	target.PhysicalDiskBytes++
	lease := &managedTargetVolumeLease{
		diskNumber: target.DiskNumber,
		handles:    []targetVolumeLeaseHandle{inertLeaseHandle{}},
	}
	if _, err := validateManagedTargetVolumeLease(target, lease); err == nil {
		t.Fatal("stale target confirmation must fail before writable disk boundary")
	}
}
