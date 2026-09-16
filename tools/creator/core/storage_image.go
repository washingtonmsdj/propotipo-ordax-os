package creatorcore

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"os"
	"unicode/utf16"
)

var microsoftBasicDataTypeGUID = [16]byte{
	0xa2, 0xa0, 0xd0, 0xeb,
	0xe5, 0xb9,
	0x33, 0x44,
	0x87, 0xc0,
	0x68, 0xb6, 0xb7, 0x26, 0x99, 0xc7,
}

func writeGPTEntryName(entry []byte, name string) error {
	if len(entry) < 128 {
		return errors.New("GPT partition entry is shorter than 128 bytes")
	}
	units := utf16.Encode([]rune(name))
	if len(units) > 36 {
		return fmt.Errorf("GPT partition name %q is too long", name)
	}
	for index := 56; index < 128; index++ {
		entry[index] = 0
	}
	for index, unit := range units {
		binary.LittleEndian.PutUint16(entry[56+index*2:58+index*2], unit)
	}
	return nil
}

func portableDataUniqueGUID(diskGUID []byte, targetBytes uint64) [16]byte {
	digest := sha256.New()
	_, _ = digest.Write([]byte("prototype-ordax:ORDAX-DATA:v1\x00"))
	_, _ = digest.Write(diskGUID)
	var capacity [8]byte
	binary.LittleEndian.PutUint64(capacity[:], targetBytes)
	_, _ = digest.Write(capacity[:])
	sum := digest.Sum(nil)
	var result [16]byte
	copy(result[:], sum[:16])
	// Mark the generated identifier as an RFC 4122-style version-5 UUID while
	// retaining GPT's on-disk byte ordering. GPT only requires uniqueness, but
	// these bits make diagnostics less surprising in partition tools.
	result[7] = (result[7] & 0x0f) | 0x50
	result[8] = (result[8] & 0x3f) | 0x80
	return result
}

// applyPortableDataLayout mutates the canonical two-partition GPT entry array
// into the storage-v2 geometry. The seed remains intentionally two-partition;
// ORDAX-DATA is target-capacity-specific and exists only in the prepared image.
func applyPortableDataLayout(entries []byte, entrySize, entryCount uint32, diskGUID []byte, layout PhysicalStorageLayout) error {
	if entrySize < 128 || len(entries) < int(entrySize*entryCount) {
		return errors.New("GPT entry array is shorter than its declared geometry")
	}
	mainOffset, err := locateCanonicalPartitions(entries, entrySize, entryCount)
	if err != nil {
		return err
	}

	espOffset := -1
	emptyOffset := -1
	for index := uint32(0); index < entryCount; index++ {
		offset := int(index * entrySize)
		entry := entries[offset : offset+int(entrySize)]
		if isZeroGUID(entry[:16]) {
			if emptyOffset < 0 {
				emptyOffset = offset
			}
			continue
		}
		switch gptEntryName(entry) {
		case "ORDAX-ESP":
			espOffset = offset
		case "ORDAX-DATA":
			return errors.New("prepared GPT already contains ORDAX-DATA")
		}
	}
	if espOffset < 0 || emptyOffset < 0 {
		return errors.New("GPT cannot add ORDAX-DATA safely")
	}

	esp := entries[espOffset : espOffset+int(entrySize)]
	main := entries[mainOffset : mainOffset+int(entrySize)]
	espStart := binary.LittleEndian.Uint64(esp[32:40])
	espLast := binary.LittleEndian.Uint64(esp[40:48])
	mainStart := binary.LittleEndian.Uint64(main[32:40])
	if espStart != layout.ESPStartLBA || espLast != layout.ESPLastLBA {
		return fmt.Errorf(
			"seed ESP geometry does not match storage-v2 contract: start=%d last=%d",
			espStart,
			espLast,
		)
	}
	if mainStart != layout.MainStartLBA {
		return fmt.Errorf("seed ORDAX start LBA=%d want=%d", mainStart, layout.MainStartLBA)
	}
	if layout.MainLastLBA >= layout.DataStartLBA || layout.DataLastLBA != layout.LastUsableLBA {
		return errors.New("storage-v2 layout contains overlapping or incomplete data geometry")
	}

	binary.LittleEndian.PutUint64(main[40:48], layout.MainLastLBA)

	data := entries[emptyOffset : emptyOffset+int(entrySize)]
	for index := range data {
		data[index] = 0
	}
	copy(data[0:16], microsoftBasicDataTypeGUID[:])
	unique := portableDataUniqueGUID(diskGUID, layout.TargetBytes)
	copy(data[16:32], unique[:])
	binary.LittleEndian.PutUint64(data[32:40], layout.DataStartLBA)
	binary.LittleEndian.PutUint64(data[40:48], layout.DataLastLBA)
	if err := writeGPTEntryName(data, "ORDAX-DATA"); err != nil {
		return err
	}
	return nil
}

// PreparePhysicalStorageImage creates the target-sized raw image using the
// proven seed material, then replaces the old "ORDAX fills the USB" geometry
// with ORDAX-ESP + bounded ORDAX + ORDAX-DATA. ORDAX-DATA is deliberately left
// unformatted here: filesystem creation is a post-readback Windows operation,
// so the raw-image trust proof never depends on host-specific filesystem bytes.
func PreparePhysicalStorageImage(seedPath, outputPath string, targetBytes uint64) (prepared PreparedPhysicalImage, retErr error) {
	layout, err := PlanPhysicalStorage(targetBytes)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	// The intermediate two-partition target-sized image is immediately mutated
	// below. Do not spend target-capacity-sized I/O hashing bytes that cannot be
	// the final authorized image; hash exactly once after storage-v2 is complete.
	prepared, err = preparePhysicalImage(seedPath, outputPath, targetBytes, false)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(prepared.Path)
		}
	}()

	file, err := os.OpenFile(prepared.Path, os.O_RDWR, 0)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("open prepared storage image: %w", err)
	}
	defer func() {
		if err := file.Close(); err != nil && retErr == nil {
			retErr = fmt.Errorf("close prepared storage image: %w", err)
		}
	}()

	primaryBlock, err := readSector(file, 1)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("read prepared primary GPT header: %w", err)
	}
	primary, err := parseGPTHeader(primaryBlock)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("validate prepared primary GPT header: %w", err)
	}
	entries, entrySectors, err := readGPTEntries(file, primary)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	if primary.LastUsableLBA != layout.LastUsableLBA {
		return PreparedPhysicalImage{}, fmt.Errorf(
			"prepared last usable LBA=%d want=%d",
			primary.LastUsableLBA,
			layout.LastUsableLBA,
		)
	}
	if len(primaryBlock) < 72 {
		return PreparedPhysicalImage{}, errors.New("prepared GPT header does not contain a disk GUID")
	}
	if err := applyPortableDataLayout(entries, primary.EntrySize, primary.EntryCount, primaryBlock[56:72], layout); err != nil {
		return PreparedPhysicalImage{}, err
	}
	entriesCRC := crc32.ChecksumIEEE(entries)

	backupBlock, err := readSector(file, primary.BackupLBA)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("read prepared secondary GPT header: %w", err)
	}
	backup, err := parseGPTHeader(backupBlock)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("validate prepared secondary GPT header: %w", err)
	}
	if backup.CurrentLBA != primary.BackupLBA || backup.BackupLBA != 1 {
		return PreparedPhysicalImage{}, errors.New("prepared secondary GPT identity is inconsistent")
	}
	backupEntriesLBA := backup.PartitionEntryLBA
	if backupEntriesLBA+entrySectors != backup.CurrentLBA {
		return PreparedPhysicalImage{}, errors.New("prepared secondary GPT entry array is not adjacent to its header")
	}

	if err := updateGPTHeader(
		primaryBlock,
		1,
		primary.BackupLBA,
		layout.LastUsableLBA,
		primary.PartitionEntryLBA,
		entriesCRC,
	); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := updateGPTHeader(
		backupBlock,
		backup.CurrentLBA,
		1,
		layout.LastUsableLBA,
		backupEntriesLBA,
		entriesCRC,
	); err != nil {
		return PreparedPhysicalImage{}, err
	}

	if _, err := file.WriteAt(entries, int64(primary.PartitionEntryLBA*gptSectorBytes)); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("write storage-v2 primary GPT entries: %w", err)
	}
	if _, err := file.WriteAt(primaryBlock, int64(gptSectorBytes)); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("write storage-v2 primary GPT header: %w", err)
	}
	paddedEntries := make([]byte, entrySectors*gptSectorBytes)
	copy(paddedEntries, entries)
	if _, err := file.WriteAt(paddedEntries, int64(backupEntriesLBA*gptSectorBytes)); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("write storage-v2 secondary GPT entries: %w", err)
	}
	if _, err := file.WriteAt(backupBlock, int64(backup.CurrentLBA*gptSectorBytes)); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("write storage-v2 secondary GPT header: %w", err)
	}
	if err := file.Sync(); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("flush storage-v2 GPT: %w", err)
	}
	digest, err := hashOpenFile(file, int64(targetBytes))
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("hash storage-v2 prepared image: %w", err)
	}

	prepared.SHA256 = digest
	prepared.LastUsableLBA = layout.LastUsableLBA
	prepared.MainLastLBA = layout.MainLastLBA
	committed = true
	return prepared, nil
}
