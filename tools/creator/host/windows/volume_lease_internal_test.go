package windowsadapter

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

type fakeTargetVolumeLeaseHandle struct {
	name          string
	diskSnapshots [][]uint32
	diskCalls     int
	dismountErr   error
	closeErr      error
	events        *[]string
	closed        bool
	dismounted    bool
}

func (h *fakeTargetVolumeLeaseHandle) DiskNumbers() ([]uint32, error) {
	phase := "extent"
	if h.dismounted {
		phase = "extent-after-dismount"
	}
	*h.events = append(*h.events, phase+":"+h.name)
	if len(h.diskSnapshots) == 0 {
		return nil, errors.New("fake handle has no disk identity")
	}
	index := h.diskCalls
	if index >= len(h.diskSnapshots) {
		index = len(h.diskSnapshots) - 1
	}
	h.diskCalls++
	return append([]uint32(nil), h.diskSnapshots[index]...), nil
}

func (h *fakeTargetVolumeLeaseHandle) Dismount() error {
	*h.events = append(*h.events, "dismount:"+h.name)
	if h.dismountErr != nil {
		return h.dismountErr
	}
	h.dismounted = true
	return nil
}

func (h *fakeTargetVolumeLeaseHandle) Close() error {
	*h.events = append(*h.events, "unlock:"+h.name)
	h.closed = true
	return h.closeErr
}

type fakeTargetVolumeLeaseRuntime struct {
	initial       []physicalVolume
	mountVolume   string
	mountErr      error
	handles       map[string]*fakeTargetVolumeLeaseHandle
	lockErr       map[string]error
	currentNames  []string
	nameErr       error
	unplanned     map[string][]uint32
	unplannedErr  map[string]error
	events        *[]string
}

func (r *fakeTargetVolumeLeaseRuntime) EnumeratePhysicalVolumes() ([]physicalVolume, error) {
	*r.events = append(*r.events, "enumerate-initial")
	copyVolumes := make([]physicalVolume, 0, len(r.initial))
	for _, volume := range r.initial {
		copyVolumes = append(copyVolumes, physicalVolume{
			VolumeName:  volume.VolumeName,
			DiskNumbers: append([]uint32(nil), volume.DiskNumbers...),
		})
	}
	return copyVolumes, nil
}

func (r *fakeTargetVolumeLeaseRuntime) ResolveMountVolume(driveLetter string) (string, error) {
	*r.events = append(*r.events, "resolve:"+driveLetter)
	if r.mountErr != nil {
		return "", r.mountErr
	}
	return r.mountVolume, nil
}

func (r *fakeTargetVolumeLeaseRuntime) OpenLockedVolume(volumeName string) (targetVolumeLeaseHandle, error) {
	key := strings.ToLower(strings.TrimSpace(volumeName))
	*r.events = append(*r.events, "lock:"+key)
	if err := r.lockErr[key]; err != nil {
		return nil, err
	}
	handle := r.handles[key]
	if handle == nil {
		return nil, fmt.Errorf("missing fake handle for %s", volumeName)
	}
	return handle, nil
}

func (r *fakeTargetVolumeLeaseRuntime) EnumerateVolumeNames() ([]string, error) {
	*r.events = append(*r.events, "enumerate-names")
	if r.nameErr != nil {
		return nil, r.nameErr
	}
	return append([]string(nil), r.currentNames...), nil
}

func (r *fakeTargetVolumeLeaseRuntime) QueryVolumeDisksReadOnly(volumeName string) ([]uint32, error) {
	key, err := normalizedVolumeOpenName(volumeName)
	if err != nil {
		return nil, err
	}
	*r.events = append(*r.events, "query-unplanned:"+key)
	if queryErr := r.unplannedErr[key]; queryErr != nil {
		return nil, queryErr
	}
	disks, ok := r.unplanned[key]
	if !ok {
		return nil, fmt.Errorf("missing fake unplanned identity for %s", volumeName)
	}
	return append([]uint32(nil), disks...), nil
}

const (
	leaseVolumeA = `\\?\Volume{11111111-1111-1111-1111-111111111111}\`
	leaseVolumeB = `\\?\Volume{22222222-2222-2222-2222-222222222222}\`
	leaseVolumeC = `\\?\Volume{33333333-3333-3333-3333-333333333333}\`
	leaseVolumeD = `\\?\Volume{44444444-4444-4444-4444-444444444444}\`
)

func mustOpenVolumeName(t *testing.T, name string) string {
	t.Helper()
	openName, err := normalizeVolumeNameForOpen(name)
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(openName)
}

func successfulLeaseRuntime(t *testing.T, events *[]string) (*fakeTargetVolumeLeaseRuntime, Target) {
	t.Helper()
	target := openedIdentityTarget()
	target.DiskNumber = 8
	target.ConfirmationToken = ConfirmationToken(target)

	keyA := mustOpenVolumeName(t, leaseVolumeA)
	keyB := mustOpenVolumeName(t, leaseVolumeB)
	keyC := mustOpenVolumeName(t, leaseVolumeC)
	return &fakeTargetVolumeLeaseRuntime{
		initial: []physicalVolume{
			{VolumeName: leaseVolumeB, DiskNumbers: []uint32{8}},
			{VolumeName: leaseVolumeA, DiskNumbers: []uint32{8}},
			{VolumeName: leaseVolumeC, DiskNumbers: []uint32{3}},
		},
		mountVolume: leaseVolumeA,
		handles: map[string]*fakeTargetVolumeLeaseHandle{
			keyA: {name: keyA, diskSnapshots: [][]uint32{{8}, {8}}, events: events},
			keyB: {name: keyB, diskSnapshots: [][]uint32{{8}, {8}}, events: events},
		},
		lockErr:      map[string]error{},
		currentNames: []string{leaseVolumeA, leaseVolumeB, leaseVolumeC},
		unplanned: map[string][]uint32{
			keyC: {3},
		},
		unplannedErr: map[string]error{},
		events:       events,
	}, target
}

func findEvent(events []string, prefix string) int {
	for index, event := range events {
		if strings.HasPrefix(event, prefix) {
			return index
		}
	}
	return -1
}

func TestAcquireTargetVolumeLeaseInternalLocksChecksDismountsAndReleases(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)

	lease, err := acquireTargetVolumeLeaseInternal(runtime, target)
	if err != nil {
		t.Fatal(err)
	}
	lockA := findEvent(events, "lock:"+mustOpenVolumeName(t, leaseVolumeA))
	lockB := findEvent(events, "lock:"+mustOpenVolumeName(t, leaseVolumeB))
	namesAt := findEvent(events, "enumerate-names")
	dismountA := findEvent(events, "dismount:"+mustOpenVolumeName(t, leaseVolumeA))
	dismountB := findEvent(events, "dismount:"+mustOpenVolumeName(t, leaseVolumeB))
	if lockA < 0 || lockB <= lockA || namesAt <= lockB || dismountA <= namesAt || dismountB <= dismountA {
		t.Fatalf("unsafe lease acquisition order: %v", events)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	unlockB := findEvent(events, "unlock:"+mustOpenVolumeName(t, leaseVolumeB))
	unlockA := findEvent(events, "unlock:"+mustOpenVolumeName(t, leaseVolumeA))
	if unlockB <= dismountB || unlockA <= unlockB {
		t.Fatalf("lease handles were not released in reverse order: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsNewTargetVolumeAfterLocks(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	keyD := mustOpenVolumeName(t, leaseVolumeD)
	runtime.currentNames = append(runtime.currentNames, leaseVolumeD)
	runtime.unplanned[keyD] = []uint32{8}

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("new target-owned volume after locks must fail closed")
	}
	if findEvent(events, "dismount:") >= 0 {
		t.Fatalf("new target volume reached dismount boundary: %v", events)
	}
	if findEvent(events, "unlock:") < 0 {
		t.Fatalf("partial lease was not released: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsDisappearedPlannedVolume(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	runtime.currentNames = []string{leaseVolumeA, leaseVolumeC}

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("disappeared planned target volume must fail closed")
	}
	if findEvent(events, "dismount:") >= 0 {
		t.Fatalf("missing target volume reached dismount boundary: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsLockedHandleCrossDiskRemap(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	keyA := mustOpenVolumeName(t, leaseVolumeA)
	runtime.handles[keyA].diskSnapshots = [][]uint32{{8, 11}}

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("locked handle spanning another disk must fail closed")
	}
	if findEvent(events, "lock:"+mustOpenVolumeName(t, leaseVolumeB)) >= 0 {
		t.Fatalf("lease continued after first locked handle lost isolation: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsPostDismountRemap(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	keyB := mustOpenVolumeName(t, leaseVolumeB)
	runtime.handles[keyB].diskSnapshots = [][]uint32{{8}, {8, 12}}

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("post-dismount target remap must fail closed")
	}
	if findEvent(events, "dismount:"+keyB) < 0 || findEvent(events, "unlock:"+keyB) < 0 {
		t.Fatalf("post-dismount failure did not safely release lease: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalReleasesAllLocksOnDismountFailure(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	keyB := mustOpenVolumeName(t, leaseVolumeB)
	runtime.handles[keyB].dismountErr = errors.New("busy volume")

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("dismount failure must fail lease acquisition")
	}
	if !runtime.handles[mustOpenVolumeName(t, leaseVolumeA)].closed || !runtime.handles[keyB].closed {
		t.Fatalf("dismount failure leaked locked volume handles: %v", events)
	}
}

func TestAcquireTargetVolumeLeaseInternalRejectsMountOutsideTargetInventory(t *testing.T) {
	events := []string{}
	runtime, target := successfulLeaseRuntime(t, &events)
	runtime.mountVolume = leaseVolumeC

	if _, err := acquireTargetVolumeLeaseInternal(runtime, target); err == nil {
		t.Fatal("drive-letter mount outside selected PhysicalDrive must fail closed")
	}
	if findEvent(events, "lock:") >= 0 {
		t.Fatalf("invalid mount identity reached volume lock boundary: %v", events)
	}
}
