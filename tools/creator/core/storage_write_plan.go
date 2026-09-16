package creatorcore

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	portableDataClearPrefixBytes = uint64(16 * 1024 * 1024)
	portableDataClearSuffixBytes = uint64(1 * 1024 * 1024)
)

var (
	efiSystemPartitionTypeGUID = [16]byte{
		0x28, 0x73, 0x2a, 0xc1, 0x1f, 0xf8, 0xd2, 0x11,
		0xba, 0x4b, 0x00, 0xa0, 0xc9, 0x3e, 0xc9, 0x3b,
	}
	linuxFilesystemTypeGUID = [16]byte{
		0xaf, 0x3d, 0xc6, 0x0f, 0x83, 0x84, 0x72, 0x47,
		0x8e, 0x79, 0x3d, 0x69, 0xd8, 0x47, 0x7d, 0xe4,
	}
)

// PhysicalWriteRegion describes one exact source-image interval that must be
// copied to and read back from the physical USB. Regions are non-overlapping,
// ordered and cover every byte controlled by the signed prepared image while
// intentionally excluding capacity-only sparse space that the bootstrap or
// Windows will initialize later.
type PhysicalWriteRegion struct {
	Role        string `json:"role"`
	OffsetBytes int64  `json:"offset_bytes"`
	LengthBytes int64  `json:"length_bytes"`
}

// PhysicalWritePlan is valid only for a fully prepared storage-v2 image whose
// primary and secondary GPTs agree with PlanPhysicalStorage for TargetBytes.
type PhysicalWritePlan struct {
	TargetBytes  uint64                `json:"target_bytes"`
	BytesToWrite int64                 `json:"bytes_to_write"`
	Regions      []PhysicalWriteRegion `json:"regions"`
}

type preparedGPTPartition struct {
	Name       string
	TypeGUID   [16]byte
	FirstLBA   uint64
	LastLBA    uint64
	EntryIndex uint32
}

func preparedGPTPartitions(entries []byte, entrySize, entryCount uint32) ([]preparedGPTPartition, error) {
	if entrySize < 128 || uint64(len(entries)) != uint64(entrySize)*uint64(entryCount) {
		return nil, errors.New("prepared GPT entry array geometry is invalid")
	}
	partitions := make([]preparedGPTPartition, 0, 3)
	seen := map[string]bool{}
	for index := uint32(0); index < entryCount; index++ {
		offset := int(index * entrySize)
		entry := entries[offset : offset+int(entrySize)]
		if isZeroGUID(entry[:16]) {
			continue
		}
		name := gptEntryName(entry)
		if name == "" {
			return nil, fmt.Errorf("prepared GPT entry %d has no partition name", index+1)
		}
		if seen[name] {
			return nil, fmt.Errorf("prepared GPT contains duplicate partition %q", name)
		}
		seen[name] = true
		var typeGUID [16]byte
		copy(typeGUID[:], entry[:16])
		first := binary.LittleEndian.Uint64(entry[32:40])
		last := binary.LittleEndian.Uint64(entry[40:48])
		if first == 0 || last < first {
			return nil, fmt.Errorf("prepared GPT partition %q has invalid LBA range", name)
		}
		partitions = append(partitions, preparedGPTPartition{
			Name:       name,
			TypeGUID:   typeGUID,
			FirstLBA:   first,
			LastLBA:    last,
			EntryIndex: index,
		})
	}
	if len(partitions) != 3 {
		return nil, fmt.Errorf("prepared GPT must contain exactly three partitions; got=%d", len(partitions))
	}
	return partitions, nil
}

func findPreparedPartition(partitions []preparedGPTPartition, name string) (preparedGPTPartition, error) {
	for _, partition := range partitions {
		if partition.Name == name {
			return partition, nil
		}
	}
	return preparedGPTPartition{}, fmt.Errorf("prepared GPT is missing %s", name)
}

func validatePreparedPartition(partition preparedGPTPartition, index uint32, expectedType [16]byte, first, last uint64) error {
	if partition.EntryIndex != index {
		return fmt.Errorf("%s must remain GPT partition %d", partition.Name, index+1)
	}
	if partition.TypeGUID != expectedType {
		return fmt.Errorf("%s GPT type GUID does not match the storage contract", partition.Name)
	}
	if partition.FirstLBA != first || partition.LastLBA != last {
		return fmt.Errorf(
			"%s geometry mismatch: got=%d-%d want=%d-%d",
			partition.Name,
			partition.FirstLBA,
			partition.LastLBA,
			first,
			last,
		)
	}
	return nil
}

func sectionIsZero(file *os.File, offset, length int64) (bool, error) {
	if offset < 0 || length <= 0 {
		return false, errors.New("zero-check section is invalid")
	}
	reader := io.NewSectionReader(file, offset, length)
	buffer := make([]byte, 1024*1024)
	remaining := length
	for remaining > 0 {
		want := int64(len(buffer))
		if remaining < want {
			want = remaining
		}
		n, err := io.ReadFull(reader, buffer[:want])
		if err != nil {
			return false, err
		}
		for _, value := range buffer[:n] {
			if value != 0 {
				return false, nil
			}
		}
		remaining -= int64(n)
	}
	return true, nil
}

// buildPreparedWriteRegions is retained for generic fixtures and compatibility.
// It covers the complete bounded ORDAX partition and therefore remains more
// conservative but slower than the canonical-seed-aware physical path.
func buildPreparedWriteRegions(layout PhysicalStorageLayout) (PhysicalWritePlan, error) {
	dataStartBytes := layout.DataStartLBA * storageSectorBytes
	dataEndBytes := (layout.DataLastLBA + 1) * storageSectorBytes
	if layout.DataBytes < portableDataClearPrefixBytes+portableDataClearSuffixBytes {
		return PhysicalWritePlan{}, errors.New("ORDAX-DATA is too small for the raw signature-clearing policy")
	}
	if dataEndBytes > layout.TargetBytes || dataStartBytes >= dataEndBytes {
		return PhysicalWritePlan{}, errors.New("ORDAX-DATA byte geometry is invalid")
	}
	headEnd := dataStartBytes + portableDataClearPrefixBytes
	tailStart := dataEndBytes - portableDataClearSuffixBytes
	if headEnd >= tailStart {
		return PhysicalWritePlan{}, errors.New("prepared write regions overlap")
	}
	if tailStart >= layout.TargetBytes {
		return PhysicalWritePlan{}, errors.New("prepared tail region does not include secondary GPT")
	}

	regions := []PhysicalWriteRegion{
		{
			Role:        "bootstrap-system-and-data-prefix",
			OffsetBytes: 0,
			LengthBytes: int64(headEnd),
		},
		{
			Role:        "data-suffix-and-secondary-gpt",
			OffsetBytes: int64(tailStart),
			LengthBytes: int64(layout.TargetBytes - tailStart),
		},
	}
	bytesToWrite := regions[0].LengthBytes + regions[1].LengthBytes
	if bytesToWrite <= 0 || uint64(bytesToWrite) >= layout.TargetBytes {
		return PhysicalWritePlan{}, errors.New("prepared region plan does not reduce physical I/O")
	}
	return PhysicalWritePlan{
		TargetBytes:  layout.TargetBytes,
		BytesToWrite: bytesToWrite,
		Regions:      regions,
	}, nil
}

// buildPreparedWriteRegionsFromSeed uses the exact canonical bootstrap seed
// size compiled into the physical backend. The seed already contains every
// byte of the FAT32 ESP and the current ext4 filesystem. Bytes between the end
// of that seed and ORDAX-DATA are capacity-only growth space for resize2fs and
// do not need to be copied or read back during USB creation.
func buildPreparedWriteRegionsFromSeed(layout PhysicalStorageLayout, seedBytes uint64) (PhysicalWritePlan, error) {
	if seedBytes == 0 || seedBytes%storageSectorBytes != 0 {
		return PhysicalWritePlan{}, errors.New("bootstrap seed size must be positive and sector aligned")
	}
	dataStartBytes := layout.DataStartLBA * storageSectorBytes
	dataEndBytes := (layout.DataLastLBA + 1) * storageSectorBytes
	if layout.DataBytes < portableDataClearPrefixBytes+portableDataClearSuffixBytes {
		return PhysicalWritePlan{}, errors.New("ORDAX-DATA is too small for the raw signature-clearing policy")
	}
	if dataEndBytes > layout.TargetBytes || dataStartBytes >= dataEndBytes {
		return PhysicalWritePlan{}, errors.New("ORDAX-DATA byte geometry is invalid")
	}
	if seedBytes >= dataStartBytes {
		return PhysicalWritePlan{}, errors.New("bootstrap seed overlaps target-specific ORDAX-DATA")
	}
	dataPrefixEnd := dataStartBytes + portableDataClearPrefixBytes
	tailStart := dataEndBytes - portableDataClearSuffixBytes
	if dataPrefixEnd >= tailStart {
		return PhysicalWritePlan{}, errors.New("prepared seed-aware write regions overlap")
	}
	if tailStart >= layout.TargetBytes {
		return PhysicalWritePlan{}, errors.New("prepared tail region does not include secondary GPT")
	}

	regions := []PhysicalWriteRegion{
		{
			Role:        "canonical-bootstrap-seed",
			OffsetBytes: 0,
			LengthBytes: int64(seedBytes),
		},
		{
			Role:        "data-signature-clear-prefix",
			OffsetBytes: int64(dataStartBytes),
			LengthBytes: int64(portableDataClearPrefixBytes),
		},
		{
			Role:        "data-suffix-and-secondary-gpt",
			OffsetBytes: int64(tailStart),
			LengthBytes: int64(layout.TargetBytes - tailStart),
		},
	}
	var bytesToWrite int64
	for index, region := range regions {
		if region.LengthBytes <= 0 || region.OffsetBytes < 0 {
			return PhysicalWritePlan{}, errors.New("prepared seed-aware region is invalid")
		}
		if index > 0 {
			previous := regions[index-1]
			if previous.OffsetBytes+previous.LengthBytes > region.OffsetBytes {
				return PhysicalWritePlan{}, errors.New("prepared seed-aware regions overlap")
			}
		}
		bytesToWrite += region.LengthBytes
	}
	if bytesToWrite <= 0 || uint64(bytesToWrite) >= layout.TargetBytes {
		return PhysicalWritePlan{}, errors.New("seed-aware region plan does not reduce physical I/O")
	}
	return PhysicalWritePlan{
		TargetBytes:  layout.TargetBytes,
		BytesToWrite: bytesToWrite,
		Regions:      regions,
	}, nil
}

// PlanPreparedPhysicalWrite validates the exact target-specific GPT before any
// destructive sparse write is permitted. Passing one bootstrapSeedBytes value
// enables the production fast path: only the canonical seed plus the required
// ORDAX-DATA signature-clearing/GPT regions are copied and read back. Omitting
// it keeps the broader legacy plan used by generic writer fixtures.
func PlanPreparedPhysicalWrite(file *os.File, targetBytes uint64, bootstrapSeedBytes ...uint64) (PhysicalWritePlan, error) {
	if file == nil {
		return PhysicalWritePlan{}, errors.New("prepared image is required")
	}
	if len(bootstrapSeedBytes) > 1 {
		return PhysicalWritePlan{}, errors.New("at most one bootstrap seed size may be supplied")
	}
	layout, err := PlanPhysicalStorage(targetBytes)
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	info, err := file.Stat()
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("stat prepared image: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() != int64(targetBytes) {
		return PhysicalWritePlan{}, errors.New("prepared image size does not match target capacity")
	}

	primaryBlock, err := readSector(file, 1)
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("read prepared primary GPT: %w", err)
	}
	primary, err := parseGPTHeader(primaryBlock)
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("validate prepared primary GPT: %w", err)
	}
	targetSectors := targetBytes / storageSectorBytes
	if primary.CurrentLBA != 1 || primary.BackupLBA != targetSectors-1 || primary.LastUsableLBA != layout.LastUsableLBA {
		return PhysicalWritePlan{}, errors.New("prepared primary GPT is not bound to the exact target capacity")
	}
	primaryEntries, primaryEntrySectors, err := readGPTEntries(file, primary)
	if err != nil {
		return PhysicalWritePlan{}, err
	}

	backupBlock, err := readSector(file, primary.BackupLBA)
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("read prepared secondary GPT: %w", err)
	}
	backup, err := parseGPTHeader(backupBlock)
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("validate prepared secondary GPT: %w", err)
	}
	if backup.CurrentLBA != primary.BackupLBA || backup.BackupLBA != 1 || backup.LastUsableLBA != layout.LastUsableLBA {
		return PhysicalWritePlan{}, errors.New("prepared secondary GPT identity is inconsistent")
	}
	if backup.EntryCount != primary.EntryCount || backup.EntrySize != primary.EntrySize || backup.EntryCRC32 != primary.EntryCRC32 {
		return PhysicalWritePlan{}, errors.New("prepared primary and secondary GPT entry metadata disagree")
	}
	if backup.PartitionEntryLBA+primaryEntrySectors != backup.CurrentLBA {
		return PhysicalWritePlan{}, errors.New("prepared secondary GPT entry array is not adjacent to its header")
	}
	if !bytes.Equal(primaryBlock[56:72], backupBlock[56:72]) {
		return PhysicalWritePlan{}, errors.New("prepared primary and secondary GPT disk GUIDs disagree")
	}
	backupEntries, _, err := readGPTEntries(file, backup)
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	if !bytes.Equal(primaryEntries, backupEntries) {
		return PhysicalWritePlan{}, errors.New("prepared primary and secondary GPT partition entries disagree")
	}

	partitions, err := preparedGPTPartitions(primaryEntries, primary.EntrySize, primary.EntryCount)
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	esp, err := findPreparedPartition(partitions, "ORDAX-ESP")
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	main, err := findPreparedPartition(partitions, "ORDAX")
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	data, err := findPreparedPartition(partitions, "ORDAX-DATA")
	if err != nil {
		return PhysicalWritePlan{}, err
	}
	if err := validatePreparedPartition(esp, 0, efiSystemPartitionTypeGUID, layout.ESPStartLBA, layout.ESPLastLBA); err != nil {
		return PhysicalWritePlan{}, err
	}
	if err := validatePreparedPartition(main, 1, linuxFilesystemTypeGUID, layout.MainStartLBA, layout.MainLastLBA); err != nil {
		return PhysicalWritePlan{}, err
	}
	if err := validatePreparedPartition(data, 2, microsoftBasicDataTypeGUID, layout.DataStartLBA, layout.DataLastLBA); err != nil {
		return PhysicalWritePlan{}, err
	}

	dataStartBytes := int64(layout.DataStartLBA * storageSectorBytes)
	prefixZero, err := sectionIsZero(file, dataStartBytes, int64(portableDataClearPrefixBytes))
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("verify ORDAX-DATA clear prefix: %w", err)
	}
	if !prefixZero {
		return PhysicalWritePlan{}, errors.New("prepared ORDAX-DATA prefix is not zero-filled")
	}
	dataEndBytes := int64((layout.DataLastLBA + 1) * storageSectorBytes)
	suffixZero, err := sectionIsZero(file, dataEndBytes-int64(portableDataClearSuffixBytes), int64(portableDataClearSuffixBytes))
	if err != nil {
		return PhysicalWritePlan{}, fmt.Errorf("verify ORDAX-DATA clear suffix: %w", err)
	}
	if !suffixZero {
		return PhysicalWritePlan{}, errors.New("prepared ORDAX-DATA suffix is not zero-filled")
	}

	if len(bootstrapSeedBytes) == 1 {
		return buildPreparedWriteRegionsFromSeed(layout, bootstrapSeedBytes[0])
	}
	return buildPreparedWriteRegions(layout)
}
