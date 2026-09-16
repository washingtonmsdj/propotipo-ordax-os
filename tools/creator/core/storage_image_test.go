package creatorcore

import (
	"encoding/binary"
	"testing"
)

func TestApplyPortableDataLayoutBoundsOrdaxAndAddsData(t *testing.T) {
	layout, err := PlanPhysicalStorage(8_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]byte, 4*128)
	copy(entries[0:128], testGPTEntry("ORDAX-ESP", layout.ESPStartLBA, layout.ESPLastLBA, 1))
	copy(entries[128:256], testGPTEntry("ORDAX", layout.MainStartLBA, layout.LastUsableLBA, 2))

	diskGUID := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	if err := applyPortableDataLayout(entries, 128, 4, diskGUID, layout); err != nil {
		t.Fatalf("applyPortableDataLayout: %v", err)
	}

	main := entries[128:256]
	if got := binary.LittleEndian.Uint64(main[40:48]); got != layout.MainLastLBA {
		t.Fatalf("ORDAX last LBA=%d want=%d", got, layout.MainLastLBA)
	}
	data := entries[256:384]
	if got := gptEntryName(data); got != "ORDAX-DATA" {
		t.Fatalf("data partition name=%q", got)
	}
	if got := binary.LittleEndian.Uint64(data[32:40]); got != layout.DataStartLBA {
		t.Fatalf("ORDAX-DATA first LBA=%d want=%d", got, layout.DataStartLBA)
	}
	if got := binary.LittleEndian.Uint64(data[40:48]); got != layout.DataLastLBA {
		t.Fatalf("ORDAX-DATA last LBA=%d want=%d", got, layout.DataLastLBA)
	}
	if got := [16]byte(data[0:16]); got != microsoftBasicDataTypeGUID {
		t.Fatalf("ORDAX-DATA GPT type=%x want=%x", got, microsoftBasicDataTypeGUID)
	}
	if isZeroGUID(data[16:32]) {
		t.Fatal("ORDAX-DATA unique GUID must not be zero")
	}
}

func TestApplyPortableDataLayoutRejectsWrongSeedGeometry(t *testing.T) {
	layout, err := PlanPhysicalStorage(8_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]byte, 4*128)
	copy(entries[0:128], testGPTEntry("ORDAX-ESP", 40, 50, 1))
	copy(entries[128:256], testGPTEntry("ORDAX", 51, layout.LastUsableLBA, 2))
	if err := applyPortableDataLayout(entries, 128, 4, make([]byte, 16), layout); err == nil {
		t.Fatal("non-canonical seed geometry must be rejected")
	}
}
