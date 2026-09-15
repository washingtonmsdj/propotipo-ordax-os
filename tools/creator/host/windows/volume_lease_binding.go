package windowsadapter

import "fmt"

// validateManagedTargetVolumeLease is the compile/runtime bridge between the
// host-neutral writer lease interface and the future native writable-disk
// primitive. A writable PhysicalDrive may only be opened while holding the
// exact managed lease returned by acquireTargetVolumeLeaseInternal for the same
// disk. Arbitrary rawVolumeLease implementations are intentionally rejected.
func validateManagedTargetVolumeLease(expected Target, lease rawVolumeLease) (*managedTargetVolumeLease, error) {
	if err := validateExpectedPhysicalTarget(expected); err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, fmt.Errorf("writable PhysicalDrive requires an active target-volume lease")
	}

	managed, ok := lease.(*managedTargetVolumeLease)
	if !ok || managed == nil {
		return nil, fmt.Errorf("writable PhysicalDrive requires the managed target-volume lease")
	}
	if managed.closed {
		return nil, fmt.Errorf("target-volume lease for PhysicalDrive%d is already closed", expected.DiskNumber)
	}
	if managed.diskNumber != expected.DiskNumber {
		return nil, fmt.Errorf("target-volume lease disk mismatch: expected=%d lease=%d", expected.DiskNumber, managed.diskNumber)
	}
	if len(managed.handles) == 0 {
		return nil, fmt.Errorf("target-volume lease for PhysicalDrive%d contains no locked volumes", expected.DiskNumber)
	}
	return managed, nil
}
