package creatorcore

import (
	"encoding/binary"
	"hash/crc32"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func testGPTEntry(name string, first, last uint64, marker byte) []byte {
	entry := make([]byte, 128)
	entry[0] = marker
	entry[16] = marker + 16
	binary.LittleEndian.PutUint64(entry[32:40], first)
	binary.LittleEndian.PutUint64(entry[40:48], last)
	units := utf16.Encode([]rune(name))
	for index, unit := range units {
		binary.LittleEndian.PutUint16(entry[56+index*2:58+index*2], unit)
	}
	return entry
}

func testGPTHeader(current, backup, firstUsable, lastUsable, entriesLBA uint64, entryCRC uint32) []byte {
	block := make([]byte, 512)
	copy(block[:8], []byte("EFI PART"))
	binary.LittleEndian.PutUint32(block[8:12], 0x00010000)
	binary.LittleEndian.PutUint32(block[12:16], 92)
	binary.LittleEndian.PutUint64(block[24:32], current)
	binary.LittleEndian.PutUint64(block[32:40], backup)
	binary.LittleEndian.PutUint64(block[40:48], firstUsable)
	binary.LittleEndian.PutUint64(block[48:56], lastUsable)
	for index := 0; index < 16; index++ {
		block[56+index] = byte(index + 1)
	}
	binary.LittleEndian.PutUint64(block[72:80], entriesLBA)
	binary.LittleEndian.PutUint32(block[80:84], 4)
	binary.LittleEndian.PutUint32(block[84:88], 128)
	binary.LittleEndian.PutUint32(block[88:92], entryCRC)
	binary.LittleEndian.PutUint32(block[16:20], crc32.ChecksumIEEE(block[:92]))
	return block
}

func writeTestGPTSeed(t *testing.T, path string, sectors uint64) {
	t.Helper()
	if sectors < 128 {
		t.Fatal("test seed must be at least 128 sectors")
	}
	data := make([]byte, sectors*512)
	data[510] = 0x55
	data[511] = 0xaa
	data[446+4] = 0xee
	binary.LittleEndian.PutUint32(data[446+8:446+12], 1)
	binary.LittleEndian.PutUint32(data[446+12:446+16], uint32(sectors-1))

	entries := make([]byte, 512)
	copy(entries[0:128], testGPTEntry("ORDAX-ESP", 40, 50, 1))
	copy(entries[128:256], testGPTEntry("ORDAX", 51, sectors-3, 2))
	entryCRC := crc32.ChecksumIEEE(entries)
	primary := testGPTHeader(1, sectors-1, 34, sectors-3, 2, entryCRC)
	backup := testGPTHeader(sectors-1, 1, 34, sectors-3, sectors-2, entryCRC)
	copy(data[512:1024], primary)
	copy(data[2*512:3*512], entries)
	copy(data[(sectors-2)*512:(sectors-1)*512], entries)
	copy(data[(sectors-1)*512:sectors*512], backup)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPreparePhysicalImageExpandsOnlyOrdaxAndRelocatesBackupGPT(t *testing.T) {
	dir := t.TempDir()
	seed := filepath.Join(dir, "seed.raw")
	output := filepath.Join(dir, "physical.raw")
	writeTestGPTSeed(t, seed, 128)

	result, err := PreparePhysicalImage(seed, output, 256*512)
	if err != nil {
		t.Fatal(err)
	}
	if result.SizeBytes != 256*512 || result.LastUsableLBA != 253 || result.MainLastLBA != 253 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(result.SHA256) != 64 {
		t.Fatalf("unexpected SHA-256: %q", result.SHA256)
	}

	file, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	primaryBlock, err := readSector(file, 1)
	if err != nil {
		t.Fatal(err)
	}
	primary, err := parseGPTHeader(primaryBlock)
	if err != nil {
		t.Fatal(err)
	}
	if primary.BackupLBA != 255 || primary.LastUsableLBA != 253 {
		t.Fatalf("unexpected expanded primary GPT: %+v", primary)
	}
	entries, _, err := readGPTEntries(file, primary)
	if err != nil {
		t.Fatal(err)
	}
	mainOffset, err := locateCanonicalPartitions(entries, primary.EntrySize, primary.EntryCount)
	if err != nil {
		t.Fatal(err)
	}
	if got := binary.LittleEndian.Uint64(entries[mainOffset+40 : mainOffset+48]); got != 253 {
		t.Fatalf("ORDAX last LBA=%d want=253", got)
	}
	backupBlock, err := readSector(file, 255)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := parseGPTHeader(backupBlock)
	if err != nil {
		t.Fatal(err)
	}
	if backup.CurrentLBA != 255 || backup.BackupLBA != 1 || backup.PartitionEntryLBA != 254 {
		t.Fatalf("unexpected expanded backup GPT: %+v", backup)
	}

	retired := make([]byte, 1024)
	if _, err := file.ReadAt(retired, 126*512); err != nil {
		t.Fatal(err)
	}
	for index, value := range retired {
		if value != 0 {
			t.Fatalf("retired GPT byte %d was not zeroed: %02x", index, value)
		}
	}
}

func TestPreparePhysicalImageRejectsUnsafeInputs(t *testing.T) {
	dir := t.TempDir()
	seed := filepath.Join(dir, "seed.raw")
	writeTestGPTSeed(t, seed, 128)

	if _, err := PreparePhysicalImage(seed, seed, 256*512); err == nil {
		t.Fatal("in-place expansion must be rejected")
	}
	if _, err := PreparePhysicalImage(seed, filepath.Join(dir, "small.raw"), 64*512); err == nil {
		t.Fatal("shrinking target must be rejected")
	}
	if _, err := PreparePhysicalImage(seed, filepath.Join(dir, "unaligned.raw"), 256*512+1); err == nil {
		t.Fatal("unaligned target must be rejected")
	}

	existing := filepath.Join(dir, "existing.raw")
	if err := os.WriteFile(existing, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePhysicalImage(seed, existing, 256*512); err == nil {
		t.Fatal("existing output must be rejected")
	}
	if got, err := os.ReadFile(existing); err != nil || string(got) != "keep" {
		t.Fatalf("existing output changed: %q err=%v", got, err)
	}
}

func TestPreparePhysicalImageRejectsCorruptGPT(t *testing.T) {
	dir := t.TempDir()
	seed := filepath.Join(dir, "seed.raw")
	writeTestGPTSeed(t, seed, 128)
	file, err := os.OpenFile(seed, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteAt([]byte{0xff}, 512+16); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePhysicalImage(seed, filepath.Join(dir, "out.raw"), 256*512); err == nil {
		t.Fatal("corrupt primary GPT must be rejected")
	}
}
