package windowsadapter

import (
	"strings"
	"testing"
)

func safeUSBTargetForRawPlan() Target {
	return FinalizeTarget(Target{
		DriveLetter:     "E:",
		VolumeLabel:     "ORDAXTEST",
		VolumeSerial:    0xabcddcba,
		DiskNumber:      9,
		VolumeBytes:     32 << 30,
		DeviceRemovable: false,
		DeviceSerial:    "USB-RAW-PLAN-1",
	}, DriveTypeFixed, true, BusTypeUSB, false)
}

func TestBuildBlockedRawDiskWritePlanBindsConfirmedPhysicalDrive(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	plan, err := BuildBlockedRawDiskWritePlan(target, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	if plan.PhysicalPath != `\\.\PhysicalDrive9` {
		t.Fatalf("physical path = %q", plan.PhysicalPath)
	}
	if plan.Status != "blocked" || plan.Strategy != "verified-full-disk-image" {
		t.Fatalf("unexpected raw plan: %#v", plan)
	}
	if plan.PhysicalWriteImplemented || plan.PhysicalWriteAuthorized {
		t.Fatal("raw-disk plan must not implement or authorize physical writes")
	}
	if !plan.RequiresElevation || !plan.RequiresCanonicalTrust || !plan.RequiresExplicitAuthorization {
		t.Fatal("raw-disk plan is missing required safety gates")
	}
	if plan.Target.ConfirmationToken != target.ConfirmationToken {
		t.Fatal("raw-disk plan lost target confirmation identity")
	}
}

func TestBuildBlockedRawDiskWritePlanRejectsStaleToken(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	changed := target
	changed.DiskNumber++
	changed.ConfirmationToken = ConfirmationToken(changed)
	if _, err := BuildBlockedRawDiskWritePlan(changed, target.ConfirmationToken); err == nil {
		t.Fatal("stale token must not create a raw-disk plan")
	}
}

func TestBuildBlockedRawDiskWritePlanRejectsUnsafeTarget(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	target.PrototypeSafe = false
	if _, err := BuildBlockedRawDiskWritePlan(target, target.ConfirmationToken); err == nil {
		t.Fatal("unsafe target must not create a raw-disk plan")
	}
}

func TestRawDiskPlanNamesFutureWriteOperationsButContainsNoWriteImplementation(t *testing.T) {
	plan, err := BuildBlockedRawDiskWritePlan(safeUSBTargetForRawPlan(), safeUSBTargetForRawPlan().ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(plan.FutureOperations, "\n")
	for _, required := range []string{"stream-verified-full-disk-image", "flush-device-buffers", "re-read-and-verify"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("future operation list missing %q", required)
		}
	}
}
