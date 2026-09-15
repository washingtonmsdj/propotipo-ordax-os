package windowsadapter

import (
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
)

const (
	volumeDiskExtentsHeaderBytes = 8
	diskExtentBytes              = 24
)

// physicalVolume models only the read-only identity needed to establish which
// mounted volumes belong to a PhysicalDrive. Lock/dismount state is
// deliberately absent; those are future destructive-boundary concerns.
type physicalVolume struct {
	VolumeName  string
	DiskNumbers []uint32
}

// parseVolumeDiskNumbers decodes the amd64 Windows VOLUME_DISK_EXTENTS layout.
// The Creator Windows candidate is currently amd64-only. Each DISK_EXTENT is
// 24 bytes and the first extent starts at byte 8 after structure alignment.
func parseVolumeDiskNumbers(buffer []byte, returned uint32) ([]uint32, error) {
	if returned > uint32(len(buffer)) {
		return nil, fmt.Errorf("volume extent response exceeds supplied buffer: returned=%d buffer=%d", returned, len(buffer))
	}
	if returned < volumeDiskExtentsHeaderBytes {
		return nil, fmt.Errorf("short VOLUME_DISK_EXTENTS response: returned=%d", returned)
	}

	count := binary.LittleEndian.Uint32(buffer[:4])
	if count == 0 {
		return nil, fmt.Errorf("VOLUME_DISK_EXTENTS reported zero extents")
	}
	if count > uint32((len(buffer)-volumeDiskExtentsHeaderBytes)/diskExtentBytes) {
		return nil, fmt.Errorf("VOLUME_DISK_EXTENTS count exceeds supplied buffer: count=%d buffer=%d", count, len(buffer))
	}
	needed := volumeDiskExtentsHeaderBytes + int(count)*diskExtentBytes
	if int(returned) < needed {
		return nil, fmt.Errorf("truncated VOLUME_DISK_EXTENTS response: count=%d needed=%d returned=%d", count, needed, returned)
	}

	seen := make(map[uint32]struct{}, count)
	disks := make([]uint32, 0, count)
	for index := uint32(0); index < count; index++ {
		offset := volumeDiskExtentsHeaderBytes + int(index)*diskExtentBytes
		diskNumber := binary.LittleEndian.Uint32(buffer[offset : offset+4])
		if _, exists := seen[diskNumber]; exists {
			continue
		}
		seen[diskNumber] = struct{}{}
		disks = append(disks, diskNumber)
	}
	sort.Slice(disks, func(i, j int) bool { return disks[i] < disks[j] })
	return disks, nil
}

func normalizeVolumeNameForOpen(volumeName string) (string, error) {
	volumeName = strings.TrimSpace(volumeName)
	if !strings.HasPrefix(volumeName, `\\?\Volume{`) || !strings.HasSuffix(volumeName, `}\`) {
		return "", fmt.Errorf("unexpected Windows volume GUID path %q", volumeName)
	}
	return strings.TrimSuffix(volumeName, `\`), nil
}

func selectPhysicalDiskVolumes(volumes []physicalVolume, diskNumber uint32) []physicalVolume {
	selected := make([]physicalVolume, 0, len(volumes))
	for _, volume := range volumes {
		contains := false
		for _, candidate := range volume.DiskNumbers {
			if candidate == diskNumber {
				contains = true
				break
			}
		}
		if !contains {
			continue
		}
		copyVolume := physicalVolume{
			VolumeName:  volume.VolumeName,
			DiskNumbers: append([]uint32(nil), volume.DiskNumbers...),
		}
		selected = append(selected, copyVolume)
	}
	sort.Slice(selected, func(i, j int) bool {
		return strings.ToUpper(selected[i].VolumeName) < strings.ToUpper(selected[j].VolumeName)
	})
	return selected
}

func volumeInventoryContainsName(volumes []physicalVolume, volumeName string) bool {
	for _, volume := range volumes {
		if strings.EqualFold(strings.TrimSpace(volume.VolumeName), strings.TrimSpace(volumeName)) {
			return true
		}
	}
	return false
}
