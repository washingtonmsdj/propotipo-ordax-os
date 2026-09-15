package windowsadapter

import (
	"encoding/binary"
	"reflect"
	"testing"
)

func encodeVolumeDiskExtents(disks ...uint32) []byte {
	buffer := make([]byte, volumeDiskExtentsHeaderBytes+len(disks)*diskExtentBytes)
	binary.LittleEndian.PutUint32(buffer[:4], uint32(len(disks)))
	for index, disk := range disks {
		offset := volumeDiskExtentsHeaderBytes + index*diskExtentBytes
		binary.LittleEndian.PutUint32(buffer[offset:offset+4], disk)
	}
	return buffer
}

func TestParseVolumeDiskNumbersAcceptsAndSortsMultipleExtents(t *testing.T) {
	buffer := encodeVolumeDiskExtents(9, 2, 9, 4)
	got, err := parseVolumeDiskNumbers(buffer, uint32(len(buffer)))
	if err != nil {
		t.Fatal(err)
	}
	want := []uint32{2, 4, 9}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("disk numbers = %v, want %v", got, want)
	}
}

func TestParseVolumeDiskNumbersRejectsZeroExtents(t *testing.T) {
	buffer := make([]byte, volumeDiskExtentsHeaderBytes)
	if _, err := parseVolumeDiskNumbers(buffer, uint32(len(buffer))); err == nil {
		t.Fatal("zero extents must be rejected")
	}
}

func TestParseVolumeDiskNumbersRejectsTruncatedResponse(t *testing.T) {
	buffer := encodeVolumeDiskExtents(3, 7)
	if _, err := parseVolumeDiskNumbers(buffer, uint32(len(buffer)-1)); err == nil {
		t.Fatal("truncated extent response must be rejected")
	}
}

func TestParseVolumeDiskNumbersRejectsReturnedBeyondBuffer(t *testing.T) {
	buffer := encodeVolumeDiskExtents(3)
	if _, err := parseVolumeDiskNumbers(buffer, uint32(len(buffer)+1)); err == nil {
		t.Fatal("returned byte count beyond supplied buffer must be rejected")
	}
}

func TestNormalizeVolumeNameForOpen(t *testing.T) {
	got, err := normalizeVolumeNameForOpen(`\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\`)
	if err != nil {
		t.Fatal(err)
	}
	want := `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`
	if got != want {
		t.Fatalf("normalized volume = %q, want %q", got, want)
	}
}

func TestNormalizeVolumeNameForOpenRejectsDriveLetter(t *testing.T) {
	if _, err := normalizeVolumeNameForOpen(`E:\`); err == nil {
		t.Fatal("drive letter must not be accepted as a volume GUID path")
	}
}

func TestSelectPhysicalDiskVolumesIncludesSpannedVolume(t *testing.T) {
	volumes := []physicalVolume{
		{VolumeName: `\\?\Volume{b}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{a}\`, DiskNumbers: []uint32{2, 8}},
		{VolumeName: `\\?\Volume{c}\`, DiskNumbers: []uint32{3}},
	}
	got := selectPhysicalDiskVolumes(volumes, 8)
	if len(got) != 2 {
		t.Fatalf("selected volume count = %d, want 2", len(got))
	}
	if got[0].VolumeName != `\\?\Volume{a}\` || got[1].VolumeName != `\\?\Volume{b}\` {
		t.Fatalf("selected volumes = %#v", got)
	}
}

func TestValidateTargetVolumeIsolationAcceptsTargetOwnedVolumes(t *testing.T) {
	volumes := []physicalVolume{
		{VolumeName: `\\?\Volume{target-a}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{target-b}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{other}\`, DiskNumbers: []uint32{3}},
		{VolumeName: `\\?\Volume{other-span}\`, DiskNumbers: []uint32{4, 5}},
	}
	if err := validateTargetVolumeIsolation(volumes, 8); err != nil {
		t.Fatal(err)
	}
}

func TestValidateTargetVolumeIsolationRejectsCrossDiskTargetVolume(t *testing.T) {
	volumes := []physicalVolume{
		{VolumeName: `\\?\Volume{target}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{span}\`, DiskNumbers: []uint32{8, 11}},
	}
	if err := validateTargetVolumeIsolation(volumes, 8); err == nil {
		t.Fatal("volume spanning the target and another physical disk must fail closed")
	}
}

func TestValidateTargetVolumeIsolationRejectsMissingDiskIdentity(t *testing.T) {
	volumes := []physicalVolume{{VolumeName: `\\?\Volume{unknown}\`}}
	if err := validateTargetVolumeIsolation(volumes, 8); err == nil {
		t.Fatal("volume without physical disk identity must fail closed")
	}
}

func TestVolumeInventoryContainsNameIsCaseInsensitive(t *testing.T) {
	volumes := []physicalVolume{{VolumeName: `\\?\Volume{ABCDEF}\`, DiskNumbers: []uint32{1}}}
	if !volumeInventoryContainsName(volumes, `\\?\volume{abcdef}\`) {
		t.Fatal("volume GUID identity should compare case-insensitively")
	}
}
