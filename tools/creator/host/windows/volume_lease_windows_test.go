//go:build windows

package windowsadapter

import "testing"

func TestWindowsVolumeLeaseControlCodesMatchWinIoctl(t *testing.T) {
	if fsctlLockVolume != 0x00090018 {
		t.Fatalf("FSCTL_LOCK_VOLUME = %#x, want %#x", fsctlLockVolume, uintptr(0x00090018))
	}
	if fsctlUnlockVolume != 0x0009001c {
		t.Fatalf("FSCTL_UNLOCK_VOLUME = %#x, want %#x", fsctlUnlockVolume, uintptr(0x0009001c))
	}
	if fsctlDismountVolume != 0x00090020 {
		t.Fatalf("FSCTL_DISMOUNT_VOLUME = %#x, want %#x", fsctlDismountVolume, uintptr(0x00090020))
	}
}

func TestWindowsLockedVolumeRejectsDismountBeforeLock(t *testing.T) {
	handle := &windowsLockedVolumeHandle{
		name:   `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`,
		handle: 1,
	}
	if err := handle.Dismount(); err == nil {
		t.Fatal("unlocked volume handle must never reach FSCTL_DISMOUNT_VOLUME")
	}
}

func TestWindowsLockedVolumeRejectsDiskQueryAfterClose(t *testing.T) {
	handle := &windowsLockedVolumeHandle{
		name:   `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`,
		handle: ^uintptr(0),
		closed: true,
	}
	if _, err := handle.DiskNumbers(); err == nil {
		t.Fatal("closed volume handle must reject extent query")
	}
}

func TestWindowsLockedVolumeRejectsDismountAfterClose(t *testing.T) {
	handle := &windowsLockedVolumeHandle{
		name:   `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`,
		handle: ^uintptr(0),
		locked: true,
		closed: true,
	}
	if err := handle.Dismount(); err == nil {
		t.Fatal("closed volume handle must reject dismount")
	}
}

func TestWindowsLockedVolumeCloseIsIdempotentWhenAlreadyClosed(t *testing.T) {
	handle := &windowsLockedVolumeHandle{
		name:   `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`,
		handle: ^uintptr(0),
		closed: true,
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}
}
