package windowsadapter

import "testing"

func lockPlanInventory() []physicalVolume {
	return []physicalVolume{
		{VolumeName: `\\?\Volume{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{cccccccc-cccc-cccc-cccc-cccccccccccc}\`, DiskNumbers: []uint32{3}},
	}
}

func TestBuildVolumeLockPlanIsDeterministicAcrossInventoryOrder(t *testing.T) {
	first, err := buildVolumeLockPlan(8, lockPlanInventory())
	if err != nil {
		t.Fatal(err)
	}

	reordered := []physicalVolume{
		{VolumeName: `\\?\Volume{cccccccc-cccc-cccc-cccc-cccccccccccc}\`, DiskNumbers: []uint32{3}},
		{VolumeName: `\\?\Volume{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}\`, DiskNumbers: []uint32{8}},
	}
	second, err := buildVolumeLockPlan(8, reordered)
	if err != nil {
		t.Fatal(err)
	}
	if first.InventorySHA256 != second.InventorySHA256 {
		t.Fatalf("inventory fingerprint changed across enumeration order: %s != %s", first.InventorySHA256, second.InventorySHA256)
	}
	if len(first.VolumeNames) != 2 {
		t.Fatalf("target volume count = %d, want 2", len(first.VolumeNames))
	}
}

func TestBuildVolumeLockPlanRejectsCrossDiskVolume(t *testing.T) {
	inventory := lockPlanInventory()
	inventory = append(inventory, physicalVolume{
		VolumeName:  `\\?\Volume{dddddddd-dddd-dddd-dddd-dddddddddddd}\`,
		DiskNumbers: []uint32{8, 9},
	})
	if _, err := buildVolumeLockPlan(8, inventory); err == nil {
		t.Fatal("cross-disk target volume must not produce a lock plan")
	}
}

func TestBuildVolumeLockPlanRejectsDuplicateVolumeIdentity(t *testing.T) {
	inventory := lockPlanInventory()
	inventory = append(inventory, physicalVolume{
		VolumeName:  `\\?\volume{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}\`,
		DiskNumbers: []uint32{8},
	})
	if _, err := buildVolumeLockPlan(8, inventory); err == nil {
		t.Fatal("duplicate case-insensitive volume identity must be rejected")
	}
}

func TestBuildVolumeLockPlanRejectsNoTargetVolumes(t *testing.T) {
	inventory := []physicalVolume{{
		VolumeName:  `\\?\Volume{cccccccc-cccc-cccc-cccc-cccccccccccc}\`,
		DiskNumbers: []uint32{3},
	}}
	if _, err := buildVolumeLockPlan(8, inventory); err == nil {
		t.Fatal("target disk with no enumerated volumes must not produce a lock plan")
	}
}

func TestValidateVolumeLockPlanInventoryAcceptsStableReenumeration(t *testing.T) {
	plan, err := buildVolumeLockPlan(8, lockPlanInventory())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateVolumeLockPlanInventory(plan, lockPlanInventory()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateVolumeLockPlanInventoryRejectsNewTargetVolume(t *testing.T) {
	plan, err := buildVolumeLockPlan(8, lockPlanInventory())
	if err != nil {
		t.Fatal(err)
	}
	current := lockPlanInventory()
	current = append(current, physicalVolume{
		VolumeName:  `\\?\Volume{eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee}\`,
		DiskNumbers: []uint32{8},
	})
	if err := validateVolumeLockPlanInventory(plan, current); err == nil {
		t.Fatal("new target volume after lock planning must invalidate the snapshot")
	}
}

func TestValidateVolumeLockPlanInventoryRejectsRemovedTargetVolume(t *testing.T) {
	plan, err := buildVolumeLockPlan(8, lockPlanInventory())
	if err != nil {
		t.Fatal(err)
	}
	current := []physicalVolume{
		{VolumeName: `\\?\Volume{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}\`, DiskNumbers: []uint32{8}},
		{VolumeName: `\\?\Volume{cccccccc-cccc-cccc-cccc-cccccccccccc}\`, DiskNumbers: []uint32{3}},
	}
	if err := validateVolumeLockPlanInventory(plan, current); err == nil {
		t.Fatal("removed target volume after lock planning must invalidate the snapshot")
	}
}

func TestValidateVolumeLockPlanInventoryRejectsCrossDiskRemap(t *testing.T) {
	plan, err := buildVolumeLockPlan(8, lockPlanInventory())
	if err != nil {
		t.Fatal(err)
	}
	current := lockPlanInventory()
	current[0].DiskNumbers = []uint32{8, 11}
	if err := validateVolumeLockPlanInventory(plan, current); err == nil {
		t.Fatal("cross-disk remap after lock planning must fail closed")
	}
}
