package windowsadapter

import (
	"strings"
	"testing"
)

func safeUSBTargetForRawPlan() Target {
	return FinalizeTarget(Target{
		DriveLetter:       "E:",
		VolumeLabel:       "ORDAXTEST",
		VolumeSerial:      0xabcddcba,
		DiskNumber:        9,
		VolumeBytes:       30 << 30,
		PhysicalDiskBytes: 32 << 30,
		DeviceRemovable:   false,
		DeviceSerial:      "USB-RAW-PLAN-1",
	}, DriveTypeFixed, true, BusTypeUSB, false)
}

func TestBuildBlockedRawDiskWritePlanBindsConfirmedPhysicalDrive(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	plan, err := BuildBlockedRawDiskWritePlan(target, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Schema != "prototype-ordax.creator-windows-raw-disk-plan/2" {
		t.Fatalf("raw plan schema = %q", plan.Schema)
	}
	if plan.PhysicalPath != `\\.\PhysicalDrive9` {
		t.Fatalf("physical path = %q", plan.PhysicalPath)
	}
	if plan.Status != "blocked" || plan.Strategy != "verified-full-disk-image" {
		t.Fatalf("unexpected raw plan: %#v", plan)
	}
	if !plan.NativeBackendImplemented {
		t.Fatal("raw-disk plan must report the unbound native backend now present in source")
	}
	if plan.PublicPhysicalApplyImplemented || plan.PhysicalWriteAuthorized {
		t.Fatal("raw-disk plan must keep public physical apply and authorization blocked")
	}
	if !plan.RequiresElevation || !plan.RequiresCanonicalTrust || !plan.RequiresExplicitAuthorization {
		t.Fatal("raw-disk plan is missing required safety gates")
	}
	if plan.Target.ConfirmationToken != target.ConfirmationToken || plan.Target.PhysicalDiskBytes != 32<<30 {
		t.Fatal("raw-disk plan lost physical target identity")
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

func TestRawDiskPlanRequiresMeasuredCapacityLeaseAndExactImageGeometry(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	plan, err := BuildBlockedRawDiskWritePlan(target, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(plan.Preconditions, "\n")
	for _, required := range []string{
		"physical-disk-capacity-measured",
		"full-disk-image-size-equals-physical-device",
		"all-target-volumes-isolated-to-confirmed-physicaldrive",
		"all-target-volumes-locked-and-dismounted-under-managed-lease",
		"writable-physicaldrive-identity-reproved-on-same-handle",
		"explicit-destructive-authorization-collected-at-apply-boundary",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("precondition list missing %q", required)
		}
	}
}

func TestRawDiskPlanNamesRemainingPromotionBlocks(t *testing.T) {
	target := safeUSBTargetForRawPlan()
	plan, err := BuildBlockedRawDiskWritePlan(target, target.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(plan.BlockedUntil, "\n")
	for _, required := range []string{
		"canonical-release-trust-is-pinned",
		"byte-complete-bootstrap-media-proof-passes-with-canonical-trust",
		"public-physical-apply-boundary-is-explicitly-implemented",
		"user-explicitly-authorizes-the-exact-destructive-operation",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("blocked-until list missing %q", required)
		}
	}
}
