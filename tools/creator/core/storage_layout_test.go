package creatorcore

import "testing"

func TestPlanPhysicalStorageEightGBLeavesPortableData(t *testing.T) {
	layout, err := PlanPhysicalStorage(8_000_000_000)
	if err != nil {
		t.Fatalf("PlanPhysicalStorage: %v", err)
	}
	if layout.ESPBytes != 256*1024*1024 {
		t.Fatalf("unexpected ESP size: %d", layout.ESPBytes)
	}
	if layout.MainBytes != 2*1024*1024*1024 {
		t.Fatalf("8GB USB should use the 2GiB system floor, got %d", layout.MainBytes)
	}
	if layout.DataBytes != 5_583_015_424 {
		t.Fatalf("unexpected portable data capacity: %d", layout.DataBytes)
	}
	if layout.MainStartLBA != 526336 {
		t.Fatalf("canonical ORDAX start changed: %d", layout.MainStartLBA)
	}
	if layout.DataStartLBA <= layout.MainLastLBA {
		t.Fatalf("ORDAX-DATA overlaps ORDAX: data=%d main-last=%d", layout.DataStartLBA, layout.MainLastLBA)
	}
	if layout.DataLastLBA != layout.LastUsableLBA {
		t.Fatalf("ORDAX-DATA must consume the remaining usable USB area")
	}
}

func TestPlanPhysicalStorageScalesSystemPartition(t *testing.T) {
	layout, err := PlanPhysicalStorage(16_000_000_000)
	if err != nil {
		t.Fatalf("PlanPhysicalStorage: %v", err)
	}
	if layout.MainBytes <= 2*1024*1024*1024 || layout.MainBytes >= 8*1024*1024*1024 {
		t.Fatalf("16GB USB should use an adaptive system partition, got %d", layout.MainBytes)
	}
	if layout.MainBytes%(1024*1024) != 0 {
		t.Fatalf("system partition must be MiB aligned: %d", layout.MainBytes)
	}
	if layout.DataBytes <= layout.MainBytes {
		t.Fatalf("portable storage should remain the larger area on a 16GB USB")
	}
}

func TestPlanPhysicalStorageCapsSystemPartition(t *testing.T) {
	layout, err := PlanPhysicalStorage(64_000_000_000)
	if err != nil {
		t.Fatalf("PlanPhysicalStorage: %v", err)
	}
	if layout.MainBytes != 8*1024*1024*1024 {
		t.Fatalf("large USB system partition should cap at 8GiB, got %d", layout.MainBytes)
	}
	if layout.DataBytes <= 50_000_000_000 {
		t.Fatalf("large USB should preserve most capacity for ORDAX-DATA, got %d", layout.DataBytes)
	}
}

func TestPlanPhysicalStorageRejectsUnusableGeometry(t *testing.T) {
	if _, err := PlanPhysicalStorage(8_000_000_001); err == nil {
		t.Fatal("unaligned capacity must be rejected")
	}
	if _, err := PlanPhysicalStorage(3_400_000_000); err == nil {
		t.Fatal("USB that cannot leave at least 1GiB for ORDAX-DATA must be rejected")
	}
}
