package windowsadapter

import (
	"errors"
	"fmt"
	"strings"
)

// targetVolumeLeaseHandle is the narrow per-volume surface required to prove a
// future native lock/dismount sequence. Production Win32 bindings are not
// connected here; tests use fake handles only.
type targetVolumeLeaseHandle interface {
	DiskNumbers() ([]uint32, error)
	Dismount() error
	Close() error
}

// targetVolumeLeaseRuntime separates the destructive Windows volume primitive
// from the policy that decides which volumes must be exclusively held. The
// runtime method OpenLockedVolume is required to return only after the named
// volume has been successfully locked.
type targetVolumeLeaseRuntime interface {
	EnumeratePhysicalVolumes() ([]physicalVolume, error)
	ResolveMountVolume(driveLetter string) (string, error)
	OpenLockedVolume(volumeName string) (targetVolumeLeaseHandle, error)
	EnumerateVolumeNames() ([]string, error)
	QueryVolumeDisksReadOnly(volumeName string) ([]uint32, error)
}

type managedTargetVolumeLease struct {
	diskNumber uint32
	handles    []targetVolumeLeaseHandle
	closed     bool
}

func (l *managedTargetVolumeLease) Close() error {
	if l == nil || l.closed {
		return nil
	}
	l.closed = true

	var errs []error
	for index := len(l.handles) - 1; index >= 0; index-- {
		if err := l.handles[index].Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func exactTargetDiskNumbers(disks []uint32, diskNumber uint32) bool {
	return len(disks) == 1 && disks[0] == diskNumber
}

func normalizedVolumeOpenName(volumeName string) (string, error) {
	name, err := normalizeVolumeNameForOpen(volumeName)
	if err != nil {
		return "", err
	}
	return strings.ToLower(name), nil
}

func closeLeaseAfterError(lease *managedTargetVolumeLease, primary error) error {
	if lease == nil {
		return primary
	}
	if cleanupErr := lease.Close(); cleanupErr != nil {
		return errors.Join(primary, fmt.Errorf("release partially acquired target-volume lease: %w", cleanupErr))
	}
	return primary
}

// acquireTargetVolumeLeaseInternal proves the full volume-ownership boundary
// around a future raw-disk operation. It is intentionally unexported and is
// tested only with fake runtimes. No Win32 lock/dismount implementation is
// connected to this function yet.
func acquireTargetVolumeLeaseInternal(runtime targetVolumeLeaseRuntime, expected Target) (rawVolumeLease, error) {
	if runtime == nil {
		return nil, errors.New("target-volume lease runtime is required")
	}
	if err := validateExpectedPhysicalTarget(expected); err != nil {
		return nil, err
	}

	initial, err := runtime.EnumeratePhysicalVolumes()
	if err != nil {
		return nil, fmt.Errorf("enumerate Windows volume extents before lock: %w", err)
	}
	if err := validateTargetVolumeIsolation(initial, expected.DiskNumber); err != nil {
		return nil, fmt.Errorf("target PhysicalDrive volume ownership is not isolated: %w", err)
	}

	mountVolume, err := runtime.ResolveMountVolume(expected.DriveLetter)
	if err != nil {
		return nil, fmt.Errorf("resolve target mount volume before lock: %w", err)
	}
	selected := selectPhysicalDiskVolumes(initial, expected.DiskNumber)
	if !volumeInventoryContainsName(selected, mountVolume) {
		return nil, fmt.Errorf("target mount volume %s is missing from PhysicalDrive%d extent inventory", mountVolume, expected.DiskNumber)
	}

	plan, err := buildVolumeLockPlan(expected.DiskNumber, initial)
	if err != nil {
		return nil, fmt.Errorf("build target-volume lock plan: %w", err)
	}
	planned := make(map[string]struct{}, len(plan.VolumeNames))
	for _, volumeName := range plan.VolumeNames {
		key := strings.ToLower(strings.TrimSpace(volumeName))
		planned[key] = struct{}{}
	}

	lease := &managedTargetVolumeLease{diskNumber: expected.DiskNumber}
	for _, volumeName := range plan.VolumeNames {
		handle, err := runtime.OpenLockedVolume(volumeName)
		if err != nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("lock target volume %s: %w", volumeName, err))
		}
		if handle == nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("lock target volume %s: runtime returned nil handle", volumeName))
		}
		lease.handles = append(lease.handles, handle)

		disks, err := handle.DiskNumbers()
		if err != nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("verify locked volume %s physical extents: %w", volumeName, err))
		}
		if !exactTargetDiskNumbers(disks, expected.DiskNumber) {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("locked volume %s escaped PhysicalDrive%d boundary: disks=%v", volumeName, expected.DiskNumber, disks))
		}
	}

	// After every planned volume is locked, enumerate volume identities again.
	// Planned volumes are not re-opened because Windows locks intentionally deny
	// independent access; unknown volumes are queried read-only. Any new volume
	// touching the target invalidates the entire lease before dismount.
	currentNames, err := runtime.EnumerateVolumeNames()
	if err != nil {
		return nil, closeLeaseAfterError(lease, fmt.Errorf("re-enumerate Windows volume names after lock: %w", err))
	}
	current := make(map[string]string, len(currentNames))
	for _, volumeName := range currentNames {
		key, err := normalizedVolumeOpenName(volumeName)
		if err != nil {
			return nil, closeLeaseAfterError(lease, err)
		}
		if _, exists := current[key]; exists {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("duplicate Windows volume identity after lock: %s", volumeName))
		}
		current[key] = volumeName
	}

	for plannedName := range planned {
		if _, exists := current[plannedName]; !exists {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("planned target volume disappeared after lock: %s", plannedName))
		}
	}
	for key, volumeName := range current {
		if _, isPlanned := planned[key]; isPlanned {
			continue
		}
		disks, err := runtime.QueryVolumeDisksReadOnly(volumeName)
		if err != nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("query unplanned volume %s after target locks: %w", volumeName, err))
		}
		for _, disk := range disks {
			if disk == expected.DiskNumber {
				return nil, closeLeaseAfterError(lease, fmt.Errorf("new unplanned volume %s appeared on PhysicalDrive%d after lock planning", volumeName, expected.DiskNumber))
			}
		}
	}

	// Dismount only after all target volumes are locked and the global volume
	// name set has been checked for new target ownership. The same locked handles
	// remain held for the lifetime of the returned lease.
	for index, volumeName := range plan.VolumeNames {
		if err := lease.handles[index].Dismount(); err != nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("dismount locked target volume %s: %w", volumeName, err))
		}
	}

	// Re-prove each dismounted volume from the same locked handle. A remap or
	// cross-disk identity change is fail-closed before any PhysicalDrive writer
	// may be opened by the caller.
	for index, volumeName := range plan.VolumeNames {
		disks, err := lease.handles[index].DiskNumbers()
		if err != nil {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("verify dismounted volume %s physical extents: %w", volumeName, err))
		}
		if !exactTargetDiskNumbers(disks, expected.DiskNumber) {
			return nil, closeLeaseAfterError(lease, fmt.Errorf("dismounted volume %s escaped PhysicalDrive%d boundary: disks=%v", volumeName, expected.DiskNumber, disks))
		}
	}

	return lease, nil
}
