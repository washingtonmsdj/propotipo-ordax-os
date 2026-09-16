package creatorcore

import (
	"bytes"
	"strings"
	"testing"
)

func TestHashPhysicalWritePlanBindsBytesAndGeometry(t *testing.T) {
	payload := make([]byte, 4096)
	for index := range payload {
		payload[index] = byte(index % 251)
	}
	plan := PhysicalWritePlan{
		TargetBytes: 8192,
		BytesToWrite: 1536,
		Regions: []PhysicalWriteRegion{
			{Role: "seed", OffsetBytes: 0, LengthBytes: 1024},
			{Role: "tail", OffsetBytes: 3584, LengthBytes: 512},
		},
	}
	first, err := HashPhysicalWritePlan(bytes.NewReader(payload), plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := HashPhysicalWritePlan(bytes.NewReader(payload), plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || len(first) != 64 || first != strings.ToLower(first) {
		t.Fatalf("write-plan digest is not stable lowercase SHA-256: %q / %q", first, second)
	}

	mutated := append([]byte(nil), payload...)
	mutated[100] ^= 0xff
	changedBytes, err := HashPhysicalWritePlan(bytes.NewReader(mutated), plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changedBytes == first {
		t.Fatal("changing an authorized region byte must change write-plan digest")
	}

	moved := plan
	moved.Regions = append([]PhysicalWriteRegion(nil), plan.Regions...)
	moved.Regions[1].OffsetBytes = 3072
	changedGeometry, err := HashPhysicalWritePlan(bytes.NewReader(payload), moved, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changedGeometry == first {
		t.Fatal("changing region geometry must change write-plan digest")
	}

	capacity := plan
	capacity.TargetBytes++
	changedCapacity, err := HashPhysicalWritePlan(bytes.NewReader(payload), capacity, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changedCapacity == first {
		t.Fatal("changing target capacity must change write-plan digest")
	}
}

func TestHashPhysicalWritePlanReportsOnlyAuthorizedBytes(t *testing.T) {
	payload := make([]byte, 8192)
	plan := PhysicalWritePlan{
		TargetBytes: 8192,
		BytesToWrite: 1024,
		Regions: []PhysicalWriteRegion{
			{Role: "head", OffsetBytes: 0, LengthBytes: 512},
			{Role: "tail", OffsetBytes: 7680, LengthBytes: 512},
		},
	}
	var lastCompleted, lastTotal int64
	if _, err := HashPhysicalWritePlan(bytes.NewReader(payload), plan, func(completed, total int64) {
		lastCompleted, lastTotal = completed, total
	}); err != nil {
		t.Fatal(err)
	}
	if lastCompleted != plan.BytesToWrite || lastTotal != plan.BytesToWrite {
		t.Fatalf("progress=%d/%d want=%d/%d", lastCompleted, lastTotal, plan.BytesToWrite, plan.BytesToWrite)
	}
}

func TestHashPhysicalWritePlanRejectsOverlapAndByteCountDrift(t *testing.T) {
	payload := make([]byte, 4096)
	overlap := PhysicalWritePlan{
		TargetBytes: 4096,
		BytesToWrite: 2048,
		Regions: []PhysicalWriteRegion{
			{Role: "one", OffsetBytes: 0, LengthBytes: 1024},
			{Role: "two", OffsetBytes: 512, LengthBytes: 1024},
		},
	}
	if _, err := HashPhysicalWritePlan(bytes.NewReader(payload), overlap, nil); err == nil {
		t.Fatal("overlapping write plan must be rejected")
	}

	drift := PhysicalWritePlan{
		TargetBytes: 4096,
		BytesToWrite: 4096,
		Regions: []PhysicalWriteRegion{{Role: "one", OffsetBytes: 0, LengthBytes: 1024}},
	}
	if _, err := HashPhysicalWritePlan(bytes.NewReader(payload), drift, nil); err == nil {
		t.Fatal("declared write byte count drift must be rejected")
	}
}
