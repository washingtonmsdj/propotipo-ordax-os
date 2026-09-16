package creatorcore

import "testing"

func TestPreparedWriteRegionsSkipUnformattedDataMiddle(t *testing.T) {
	layout, err := PlanPhysicalStorage(8_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := buildPreparedWriteRegions(layout)
	if err != nil {
		t.Fatal(err)
	}
	if plan.TargetBytes != layout.TargetBytes {
		t.Fatalf("target bytes=%d want=%d", plan.TargetBytes, layout.TargetBytes)
	}
	if len(plan.Regions) != 2 {
		t.Fatalf("region count=%d want=2", len(plan.Regions))
	}

	head := plan.Regions[0]
	tail := plan.Regions[1]
	dataStartBytes := int64(layout.DataStartLBA * storageSectorBytes)
	dataEndBytes := int64((layout.DataLastLBA + 1) * storageSectorBytes)
	if head.OffsetBytes != 0 {
		t.Fatalf("head offset=%d want=0", head.OffsetBytes)
	}
	if head.LengthBytes != dataStartBytes+int64(portableDataClearPrefixBytes) {
		t.Fatalf("head length=%d", head.LengthBytes)
	}
	if tail.OffsetBytes != dataEndBytes-int64(portableDataClearSuffixBytes) {
		t.Fatalf("tail offset=%d", tail.OffsetBytes)
	}
	if tail.OffsetBytes+tail.LengthBytes != int64(layout.TargetBytes) {
		t.Fatal("tail region must include the secondary GPT through target end")
	}
	if head.OffsetBytes+head.LengthBytes >= tail.OffsetBytes {
		t.Fatal("prepared write regions must not overlap")
	}
	if plan.BytesToWrite != head.LengthBytes+tail.LengthBytes {
		t.Fatalf("bytes to write=%d do not match region total", plan.BytesToWrite)
	}
	if plan.BytesToWrite >= int64(layout.TargetBytes) {
		t.Fatal("optimized plan must write less than whole target")
	}
	// On the user's 8 GB class media the raw USB I/O must stay well below half
	// the device capacity; ORDAX-DATA is formatted after readback verification.
	if plan.BytesToWrite >= int64(layout.TargetBytes/2) {
		t.Fatalf("optimized write still touches too much media: %d of %d", plan.BytesToWrite, layout.TargetBytes)
	}
}

func TestPreparedWriteRegionsIncludeMainAndBothGPTCopies(t *testing.T) {
	layout, err := PlanPhysicalStorage(64_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := buildPreparedWriteRegions(layout)
	if err != nil {
		t.Fatal(err)
	}
	head := plan.Regions[0]
	tail := plan.Regions[1]
	mainEnd := int64((layout.MainLastLBA + 1) * storageSectorBytes)
	if head.LengthBytes <= mainEnd {
		t.Fatal("head region must include the complete ORDAX partition and data clear prefix")
	}
	backupGPTOffset := int64((layout.LastUsableLBA + 1) * storageSectorBytes)
	if tail.OffsetBytes >= backupGPTOffset {
		t.Fatal("tail must begin inside ORDAX-DATA before the secondary GPT")
	}
	if tail.OffsetBytes+tail.LengthBytes != int64(layout.TargetBytes) {
		t.Fatal("tail must cover the end of the physical target")
	}
}

func TestSeedBoundedWriteRegionsStayNearBootstrapSize(t *testing.T) {
	layout, err := PlanPhysicalStorage(64_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	seedBytes := uint64(512 * 1024 * 1024)
	plan, err := buildPreparedWriteRegionsFromSeed(layout, seedBytes)
	if err != nil {
		t.Fatal(err)
	}
	if plan.TargetBytes != layout.TargetBytes {
		t.Fatalf("target bytes=%d want=%d", plan.TargetBytes, layout.TargetBytes)
	}
	if len(plan.Regions) != 3 {
		t.Fatalf("region count=%d want=3", len(plan.Regions))
	}
	if got := plan.Regions[0]; got.Role != "canonical-bootstrap-seed" || got.OffsetBytes != 0 || got.LengthBytes != int64(seedBytes) {
		t.Fatalf("bootstrap region=%+v", got)
	}
	if got := plan.Regions[1]; got.Role != "data-signature-clear-prefix" || got.LengthBytes != int64(portableDataClearPrefixBytes) {
		t.Fatalf("data prefix region=%+v", got)
	}
	if got := plan.Regions[2]; got.Role != "data-suffix-and-secondary-gpt" || got.LengthBytes < int64(portableDataClearSuffixBytes) {
		t.Fatalf("data suffix region=%+v", got)
	}
	for index := 1; index < len(plan.Regions); index++ {
		previous := plan.Regions[index-1]
		current := plan.Regions[index]
		if previous.OffsetBytes+previous.LengthBytes > current.OffsetBytes {
			t.Fatalf("regions overlap: previous=%+v current=%+v", previous, current)
		}
	}
	// 512 MiB seed + 16 MiB prefix + roughly 1 MiB suffix/GPT should remain
	// comfortably below 600 MiB even on a 64 GB target. This regression keeps
	// USB creation time tied to actual bootstrap bytes instead of target size.
	if plan.BytesToWrite >= int64(600*1024*1024) {
		t.Fatalf("seed-bounded plan writes too much: %d bytes", plan.BytesToWrite)
	}
	if plan.BytesToWrite >= int64(layout.MainBytes) {
		t.Fatalf("seed-bounded plan unexpectedly scales with reserved ORDAX capacity: write=%d main=%d", plan.BytesToWrite, layout.MainBytes)
	}
}

func TestSeedBoundedWriteRegionsRejectSeedOverlappingData(t *testing.T) {
	layout, err := PlanPhysicalStorage(16_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	overlap := layout.DataStartLBA * storageSectorBytes
	if _, err := buildPreparedWriteRegionsFromSeed(layout, overlap); err == nil {
		t.Fatal("seed overlapping ORDAX-DATA must be rejected")
	}
}
