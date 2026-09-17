package creatorcore

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

const (
	gptSectorBytes   = uint64(512)
	gptHeaderMinSize = uint32(92)
	gptHeaderMaxSize = uint32(512)
)

type PreparedPhysicalImage struct {
	Path          string `json:"path"`
	SizeBytes     int64  `json:"size_bytes"`
	SHA256        string `json:"sha256"`
	LastUsableLBA uint64 `json:"last_usable_lba"`
	MainLastLBA   uint64 `json:"main_last_lba"`
}

type parsedGPTHeader struct {
	HeaderSize        uint32
	CurrentLBA        uint64
	BackupLBA         uint64
	FirstUsableLBA    uint64
	LastUsableLBA     uint64
	PartitionEntryLBA uint64
	EntryCount        uint32
	EntrySize         uint32
	EntryCRC32        uint32
}

func parseGPTHeader(block []byte) (parsedGPTHeader, error) {
	if len(block) < int(gptSectorBytes) || string(block[:8]) != "EFI PART" {
		return parsedGPTHeader{}, errors.New("invalid GPT header signature")
	}
	headerSize := binary.LittleEndian.Uint32(block[12:16])
	if headerSize < gptHeaderMinSize || headerSize > gptHeaderMaxSize || int(headerSize) > len(block) {
		return parsedGPTHeader{}, fmt.Errorf("invalid GPT header size: %d", headerSize)
	}
	storedCRC := binary.LittleEndian.Uint32(block[16:20])
	check := append([]byte(nil), block[:headerSize]...)
	binary.LittleEndian.PutUint32(check[16:20], 0)
	if actual := crc32.ChecksumIEEE(check); actual != storedCRC {
		return parsedGPTHeader{}, fmt.Errorf("GPT header CRC mismatch: expected=%08x actual=%08x", storedCRC, actual)
	}
	header := parsedGPTHeader{
		HeaderSize:        headerSize,
		CurrentLBA:        binary.LittleEndian.Uint64(block[24:32]),
		BackupLBA:         binary.LittleEndian.Uint64(block[32:40]),
		FirstUsableLBA:    binary.LittleEndian.Uint64(block[40:48]),
		LastUsableLBA:     binary.LittleEndian.Uint64(block[48:56]),
		PartitionEntryLBA: binary.LittleEndian.Uint64(block[72:80]),
		EntryCount:        binary.LittleEndian.Uint32(block[80:84]),
		EntrySize:         binary.LittleEndian.Uint32(block[84:88]),
		EntryCRC32:        binary.LittleEndian.Uint32(block[88:92]),
	}
	if header.EntryCount == 0 || header.EntryCount > 1024 {
		return parsedGPTHeader{}, fmt.Errorf("unsupported GPT entry count: %d", header.EntryCount)
	}
	if header.EntrySize < 128 || header.EntrySize > 4096 || header.EntrySize%8 != 0 {
		return parsedGPTHeader{}, fmt.Errorf("unsupported GPT entry size: %d", header.EntrySize)
	}
	if header.FirstUsableLBA > header.LastUsableLBA {
		return parsedGPTHeader{}, errors.New("GPT usable LBA range is inverted")
	}
	return header, nil
}

func readSector(file *os.File, lba uint64) ([]byte, error) {
	if lba > uint64(^uint64(0))/gptSectorBytes {
		return nil, errors.New("GPT LBA overflow")
	}
	block := make([]byte, gptSectorBytes)
	if _, err := file.ReadAt(block, int64(lba*gptSectorBytes)); err != nil {
		return nil, err
	}
	return block, nil
}

func gptEntryBytes(header parsedGPTHeader) (uint64, uint64, error) {
	bytes := uint64(header.EntryCount) * uint64(header.EntrySize)
	if bytes == 0 || bytes > 16*1024*1024 {
		return 0, 0, errors.New("GPT partition entry array size is invalid")
	}
	sectors := (bytes + gptSectorBytes - 1) / gptSectorBytes
	return bytes, sectors, nil
}

func readGPTEntries(file *os.File, header parsedGPTHeader) ([]byte, uint64, error) {
	entryBytes, entrySectors, err := gptEntryBytes(header)
	if err != nil {
		return nil, 0, err
	}
	entries := make([]byte, entryBytes)
	if _, err := file.ReadAt(entries, int64(header.PartitionEntryLBA*gptSectorBytes)); err != nil {
		return nil, 0, fmt.Errorf("read GPT partition entries: %w", err)
	}
	if actual := crc32.ChecksumIEEE(entries); actual != header.EntryCRC32 {
		return nil, 0, fmt.Errorf("GPT partition entry CRC mismatch: expected=%08x actual=%08x", header.EntryCRC32, actual)
	}
	return entries, entrySectors, nil
}

func gptEntryName(entry []byte) string {
	if len(entry) < 128 {
		return ""
	}
	units := make([]uint16, 0, 36)
	for offset := 56; offset+1 < 128; offset += 2 {
		unit := binary.LittleEndian.Uint16(entry[offset : offset+2])
		if unit == 0 {
			break
		}
		units = append(units, unit)
	}
	return string(utf16.Decode(units))
}

func isZeroGUID(value []byte) bool {
	if len(value) < 16 {
		return true
	}
	for _, item := range value[:16] {
		if item != 0 {
			return false
		}
	}
	return true
}

func locateCanonicalPartitions(entries []byte, entrySize uint32, entryCount uint32) (mainOffset int, err error) {
	mainOffset = -1
	nonEmpty := 0
	espFound := false
	for index := uint32(0); index < entryCount; index++ {
		offset := int(index * entrySize)
		entry := entries[offset : offset+int(entrySize)]
		if isZeroGUID(entry[:16]) {
			continue
		}
		nonEmpty++
		switch gptEntryName(entry) {
		case "ORDAX-ESP":
			if espFound {
				return -1, errors.New("GPT contains duplicate ORDAX-ESP partitions")
			}
			espFound = true
		case "ORDAX":
			if mainOffset >= 0 {
				return -1, errors.New("GPT contains duplicate ORDAX partitions")
			}
			mainOffset = offset
		}
	}
	if nonEmpty != 2 || !espFound || mainOffset < 0 {
		return -1, errors.New("physical seed must contain exactly ORDAX-ESP and ORDAX partitions")
	}
	return mainOffset, nil
}

func updateGPTHeader(block []byte, currentLBA, backupLBA, lastUsableLBA, entriesLBA uint64, entriesCRC uint32) error {
	if len(block) < int(gptSectorBytes) {
		return errors.New("GPT header block is short")
	}
	headerSize := binary.LittleEndian.Uint32(block[12:16])
	if headerSize < gptHeaderMinSize || headerSize > gptHeaderMaxSize {
		return errors.New("GPT header size is invalid")
	}
	binary.LittleEndian.PutUint64(block[24:32], currentLBA)
	binary.LittleEndian.PutUint64(block[32:40], backupLBA)
	binary.LittleEndian.PutUint64(block[48:56], lastUsableLBA)
	binary.LittleEndian.PutUint64(block[72:80], entriesLBA)
	binary.LittleEndian.PutUint32(block[88:92], entriesCRC)
	binary.LittleEndian.PutUint32(block[16:20], 0)
	binary.LittleEndian.PutUint32(block[16:20], crc32.ChecksumIEEE(block[:headerSize]))
	return nil
}

func updateProtectiveMBR(block []byte, targetSectors uint64) error {
	if len(block) < int(gptSectorBytes) || block[510] != 0x55 || block[511] != 0xaa {
		return errors.New("invalid protective MBR signature")
	}
	for index := 0; index < 4; index++ {
		offset := 446 + index*16
		if block[offset+4] != 0xee || binary.LittleEndian.Uint32(block[offset+8:offset+12]) != 1 {
			continue
		}
		sectors := targetSectors - 1
		if sectors > uint64(^uint32(0)) {
			sectors = uint64(^uint32(0))
		}
		binary.LittleEndian.PutUint32(block[offset+12:offset+16], uint32(sectors))
		return nil
	}
	return errors.New("protective MBR does not contain a GPT 0xEE entry starting at LBA 1")
}

func hashOpenFile(file *os.File, size int64) (string, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	digest := sha256.New()
	written, err := io.CopyN(digest, file, size)
	if err != nil {
		return "", err
	}
	if written != size {
		return "", fmt.Errorf("physical image hash length mismatch: expected=%d actual=%d", size, written)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// PreparePhysicalImage expands a verified GPT seed layout to the exact target
// capacity without touching a physical device. It preserves ORDAX-ESP, extends
// only the ORDAX partition through the new last usable LBA, relocates the
// secondary GPT to the real end of the image and recomputes every affected CRC.
// The ext4 filesystem itself is intentionally not grown here; that is a later
// filesystem concern and keeps this operation limited to disk geometry.
func PreparePhysicalImage(seedPath, outputPath string, targetBytes uint64) (PreparedPhysicalImage, error) {
	return preparePhysicalImage(seedPath, outputPath, targetBytes, true)
}

// preparePhysicalImage is also used as the first phase of storage-v2
// preparation. Storage-v2 immediately rewrites GPT entries and therefore must
// hash only its final bytes; hashing this intermediate image first is pure
// target-capacity-sized overhead.
func preparePhysicalImage(seedPath, outputPath string, targetBytes uint64, computeDigest bool) (PreparedPhysicalImage, error) {
	if strings.TrimSpace(seedPath) == "" || strings.TrimSpace(outputPath) == "" {
		return PreparedPhysicalImage{}, errors.New("seed and output paths are required")
	}
	seedAbs, err := filepath.Abs(seedPath)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	outputAbs, err := filepath.Abs(outputPath)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	if filepath.Clean(seedAbs) == filepath.Clean(outputAbs) {
		return PreparedPhysicalImage{}, errors.New("physical image output must differ from seed image")
	}
	if targetBytes%gptSectorBytes != 0 || targetBytes > uint64(^uint64(0)>>1) {
		return PreparedPhysicalImage{}, errors.New("target capacity must be a positive 512-byte-aligned size")
	}
	if _, err := os.Lstat(outputAbs); err == nil {
		return PreparedPhysicalImage{}, errors.New("physical image output already exists")
	} else if !os.IsNotExist(err) {
		return PreparedPhysicalImage{}, err
	}

	seedInfo, err := os.Lstat(seedAbs)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("stat physical seed: %w", err)
	}
	if seedInfo.Mode()&os.ModeSymlink != 0 || !seedInfo.Mode().IsRegular() || seedInfo.Size() <= 0 {
		return PreparedPhysicalImage{}, errors.New("physical seed must be a non-empty regular non-symlink file")
	}
	if seedInfo.Size()%int64(gptSectorBytes) != 0 || targetBytes < uint64(seedInfo.Size()) {
		return PreparedPhysicalImage{}, errors.New("target capacity must be at least the aligned seed image size")
	}
	targetSectors := targetBytes / gptSectorBytes
	if targetSectors < 68 {
		return PreparedPhysicalImage{}, errors.New("target capacity is too small for GPT")
	}

	seed, err := os.Open(seedAbs)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	defer seed.Close()

	mbr, err := readSector(seed, 0)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("read protective MBR: %w", err)
	}
	primaryBlock, err := readSector(seed, 1)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("read primary GPT header: %w", err)
	}
	primary, err := parseGPTHeader(primaryBlock)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("validate primary GPT header: %w", err)
	}
	seedSectors := uint64(seedInfo.Size()) / gptSectorBytes
	if primary.CurrentLBA != 1 || primary.BackupLBA != seedSectors-1 {
		return PreparedPhysicalImage{}, errors.New("seed GPT primary/backup locations do not match seed capacity")
	}
	entries, entrySectors, err := readGPTEntries(seed, primary)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	mainOffset, err := locateCanonicalPartitions(entries, primary.EntrySize, primary.EntryCount)
	if err != nil {
		return PreparedPhysicalImage{}, err
	}
	mainStart := binary.LittleEndian.Uint64(entries[mainOffset+32 : mainOffset+40])
	mainLast := binary.LittleEndian.Uint64(entries[mainOffset+40 : mainOffset+48])
	if mainStart < primary.FirstUsableLBA || mainLast > primary.LastUsableLBA || mainStart > mainLast {
		return PreparedPhysicalImage{}, errors.New("ORDAX partition geometry is invalid in seed image")
	}

	backupBlock, err := readSector(seed, primary.BackupLBA)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("read secondary GPT header: %w", err)
	}
	backup, err := parseGPTHeader(backupBlock)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("validate secondary GPT header: %w", err)
	}
	if backup.CurrentLBA != primary.BackupLBA || backup.BackupLBA != 1 || backup.EntryCRC32 != primary.EntryCRC32 {
		return PreparedPhysicalImage{}, errors.New("secondary GPT does not mirror primary GPT identity")
	}
	backupEntries, _, err := readGPTEntries(seed, backup)
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("validate secondary GPT entries: %w", err)
	}
	if string(backupEntries) != string(entries) {
		return PreparedPhysicalImage{}, errors.New("primary and secondary GPT entry arrays differ")
	}

	newBackupLBA := targetSectors - 1
	if newBackupLBA <= entrySectors+primary.FirstUsableLBA {
		return PreparedPhysicalImage{}, errors.New("target capacity leaves no usable ORDAX partition range")
	}
	newBackupEntriesLBA := newBackupLBA - entrySectors
	newLastUsableLBA := newBackupEntriesLBA - 1
	if newLastUsableLBA < primary.LastUsableLBA || newLastUsableLBA < mainStart {
		return PreparedPhysicalImage{}, errors.New("target capacity cannot preserve seed GPT geometry")
	}
	binary.LittleEndian.PutUint64(entries[mainOffset+40:mainOffset+48], newLastUsableLBA)
	entriesCRC := crc32.ChecksumIEEE(entries)

	if err := updateProtectiveMBR(mbr, targetSectors); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := updateGPTHeader(primaryBlock, 1, newBackupLBA, newLastUsableLBA, primary.PartitionEntryLBA, entriesCRC); err != nil {
		return PreparedPhysicalImage{}, err
	}
	backupBlock = append([]byte(nil), primaryBlock...)
	if err := updateGPTHeader(backupBlock, newBackupLBA, 1, newLastUsableLBA, newBackupEntriesLBA, entriesCRC); err != nil {
		return PreparedPhysicalImage{}, err
	}

	outputDir := filepath.Dir(outputAbs)
	temp, err := os.CreateTemp(outputDir, ".ordax-physical-image-*")
	if err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("create physical image staging file: %w", err)
	}
	tempPath := temp.Name()
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = os.Remove(tempPath)
		}
	}()
	if err := configurePhysicalImageStaging(temp); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("configure physical image staging file: %w", err)
	}
	if _, err := seed.Seek(0, io.SeekStart); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if _, err := io.Copy(temp, seed); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("copy physical seed: %w", err)
	}
	if err := temp.Truncate(int64(targetBytes)); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("resize physical image staging file: %w", err)
	}

	writeAt := func(label string, data []byte, offset uint64) error {
		if _, err := temp.WriteAt(data, int64(offset)); err != nil {
			return fmt.Errorf("write %s: %w", label, err)
		}
		return nil
	}
	if err := writeAt("protective MBR", mbr, 0); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := writeAt("primary GPT entries", entries, primary.PartitionEntryLBA*gptSectorBytes); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := writeAt("primary GPT header", primaryBlock, gptSectorBytes); err != nil {
		return PreparedPhysicalImage{}, err
	}

	// The seed's old backup GPT becomes ordinary free space inside the enlarged
	// ORDAX partition. Zero it so stale GPT signatures do not survive there.
	oldBackupStart := backup.PartitionEntryLBA * gptSectorBytes
	oldBackupEnd := (backup.CurrentLBA + 1) * gptSectorBytes
	if oldBackupEnd > oldBackupStart {
		zeros := make([]byte, oldBackupEnd-oldBackupStart)
		if err := writeAt("retired secondary GPT region", zeros, oldBackupStart); err != nil {
			return PreparedPhysicalImage{}, err
		}
	}

	paddedEntries := make([]byte, entrySectors*gptSectorBytes)
	copy(paddedEntries, entries)
	if err := writeAt("secondary GPT entries", paddedEntries, newBackupEntriesLBA*gptSectorBytes); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := writeAt("secondary GPT header", backupBlock, newBackupLBA*gptSectorBytes); err != nil {
		return PreparedPhysicalImage{}, err
	}
	if err := temp.Sync(); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("flush prepared physical image: %w", err)
	}

	digest := ""
	if computeDigest {
		digest, err = hashOpenFile(temp, int64(targetBytes))
		if err != nil {
			return PreparedPhysicalImage{}, fmt.Errorf("hash prepared physical image: %w", err)
		}
	}
	if err := temp.Close(); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("close prepared physical image: %w", err)
	}
	if err := os.Rename(tempPath, outputAbs); err != nil {
		return PreparedPhysicalImage{}, fmt.Errorf("publish prepared physical image: %w", err)
	}
	committed = true
	return PreparedPhysicalImage{
		Path:          outputAbs,
		SizeBytes:     int64(targetBytes),
		SHA256:        digest,
		LastUsableLBA: newLastUsableLBA,
		MainLastLBA:   newLastUsableLBA,
	}, nil
}
