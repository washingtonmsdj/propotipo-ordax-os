package windowsadapter

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

// volumeLockPlan is a host-neutral proof object for a future Windows
// lock/dismount implementation. It contains only isolated target-owned volume
// GUIDs plus a deterministic fingerprint of that exact target volume set. It
// performs no host operation by itself.
type volumeLockPlan struct {
	DiskNumber      uint32
	VolumeNames     []string
	InventorySHA256 string
}

func canonicalVolumeInventoryFingerprint(diskNumber uint32, volumeNames []string) string {
	hash := sha256.New()
	var word [4]byte
	binary.LittleEndian.PutUint32(word[:], diskNumber)
	_, _ = hash.Write(word[:])

	for _, name := range volumeNames {
		canonical := strings.ToLower(strings.TrimSpace(name))
		binary.LittleEndian.PutUint32(word[:], uint32(len(canonical)))
		_, _ = hash.Write(word[:])
		_, _ = hash.Write([]byte(canonical))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// buildVolumeLockPlan accepts an all-volume inventory, selects only volumes
// touching the confirmed disk, rejects cross-disk ownership, normalizes GUID
// paths for CreateFileW and snapshots the complete target-owned set. The plan
// is deliberately inert: native volume lock/dismount calls are not connected.
func buildVolumeLockPlan(diskNumber uint32, volumes []physicalVolume) (volumeLockPlan, error) {
	if err := validateTargetVolumeIsolation(volumes, diskNumber); err != nil {
		return volumeLockPlan{}, err
	}

	selected := selectPhysicalDiskVolumes(volumes, diskNumber)
	if len(selected) == 0 {
		return volumeLockPlan{}, fmt.Errorf("PhysicalDrive%d has no enumerated Windows volumes", diskNumber)
	}

	names := make([]string, 0, len(selected))
	seen := make(map[string]struct{}, len(selected))
	for _, volume := range selected {
		openName, err := normalizeVolumeNameForOpen(volume.VolumeName)
		if err != nil {
			return volumeLockPlan{}, err
		}
		key := strings.ToLower(openName)
		if _, exists := seen[key]; exists {
			return volumeLockPlan{}, fmt.Errorf("duplicate Windows volume identity in PhysicalDrive%d inventory: %s", diskNumber, volume.VolumeName)
		}
		seen[key] = struct{}{}
		names = append(names, openName)
	}

	sort.Slice(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})

	return volumeLockPlan{
		DiskNumber:      diskNumber,
		VolumeNames:     names,
		InventorySHA256: canonicalVolumeInventoryFingerprint(diskNumber, names),
	}, nil
}

// validateVolumeLockPlanInventory is intended for the mandatory re-enumeration
// after a future lock sequence and before a writable PhysicalDrive is opened.
// Any target-volume appearance, disappearance, remap or cross-disk span changes
// the plan/fingerprint and fails closed.
func validateVolumeLockPlanInventory(plan volumeLockPlan, current []physicalVolume) error {
	if plan.InventorySHA256 == "" || len(plan.VolumeNames) == 0 {
		return fmt.Errorf("volume lock plan is incomplete")
	}
	refreshed, err := buildVolumeLockPlan(plan.DiskNumber, current)
	if err != nil {
		return err
	}
	if refreshed.InventorySHA256 != plan.InventorySHA256 {
		return fmt.Errorf("PhysicalDrive%d volume inventory changed after lock planning: expected=%s actual=%s", plan.DiskNumber, plan.InventorySHA256, refreshed.InventorySHA256)
	}
	return nil
}
