//go:build windows

package main

import "testing"

func TestPhysicalProgressPresentationUsesByteProgressForWriteAndVerify(t *testing.T) {
	write := physicalProgressDocument{Schema: physicalProgressSchema, Phase: "writing", CompletedBytes: 50, TotalBytes: 100}
	_, _, writePercent, ok := physicalProgressPresentation(write)
	if !ok {
		t.Fatal("writing phase must be recognized")
	}
	if writePercent != 37 {
		t.Fatalf("writing percent=%d want=37", writePercent)
	}

	verify := physicalProgressDocument{Schema: physicalProgressSchema, Phase: "verifying", CompletedBytes: 50, TotalBytes: 100}
	_, _, verifyPercent, ok := physicalProgressPresentation(verify)
	if !ok {
		t.Fatal("verifying phase must be recognized")
	}
	if verifyPercent != 76 {
		t.Fatalf("verifying percent=%d want=76", verifyPercent)
	}
}

func TestPhysicalProgressPresentationCompletesAtOneHundred(t *testing.T) {
	_, _, percent, ok := physicalProgressPresentation(physicalProgressDocument{Schema: physicalProgressSchema, Phase: "complete", CompletedBytes: 1, TotalBytes: 1})
	if !ok || percent != 100 {
		t.Fatalf("complete progress=(%d,%v) want=(100,true)", percent, ok)
	}
}
