package windowsadapter

import (
	"errors"
	"fmt"
	"strings"
)

// openedPhysicalIdentity is the disk-level identity that must be read from the
// exact PhysicalDrive handle a native writer intends to use. It deliberately
// excludes volume-only fields because those belong to the pre-open live target
// confirmation; this structure closes the subsequent disk-number/handle TOCTOU
// boundary.
type openedPhysicalIdentity struct {
	DiskNumber        uint32
	PhysicalDiskBytes uint64
	BusType           uint32
	DeviceRemovable   bool
	DeviceSerial      string
}

// validateExpectedPhysicalTarget checks every Target-owned invariant that can
// be established before opening a PhysicalDrive handle. Keeping this policy
// host-neutral makes stale or internally modified targets fail before any host
// raw-device API is touched.
func validateExpectedPhysicalTarget(expected Target) error {
	if !expected.PrototypeSafe {
		return errors.New("PhysicalDrive validation requires a prototype-safe target")
	}
	if expected.SystemDisk {
		return errors.New("PhysicalDrive validation refuses the Windows system disk")
	}
	if expected.BusType != "usb" {
		return fmt.Errorf("PhysicalDrive validation requires USB target identity: bus_type=%q", expected.BusType)
	}
	if expected.PhysicalDiskBytes == 0 {
		return errors.New("PhysicalDrive validation requires measured target capacity")
	}
	if expected.ConfirmationToken == "" || expected.ConfirmationToken != ConfirmationToken(expected) {
		return errors.New("PhysicalDrive validation requires a current target confirmation token")
	}
	return nil
}

// validateOpenedPhysicalIdentity proves that an already-opened PhysicalDrive
// handle still represents the same safe physical device selected by the
// confirmed Target. A future native writer must call this on the same handle it
// would write, before any lock/dismount/write primitive is allowed.
func validateOpenedPhysicalIdentity(expected Target, actual openedPhysicalIdentity) error {
	if err := validateExpectedPhysicalTarget(expected); err != nil {
		return err
	}
	if actual.DiskNumber != expected.DiskNumber {
		return fmt.Errorf("opened PhysicalDrive number changed: expected=%d actual=%d", expected.DiskNumber, actual.DiskNumber)
	}
	if actual.BusType != BusTypeUSB {
		return fmt.Errorf("opened PhysicalDrive transport is not USB: bus_type=%d", actual.BusType)
	}
	if actual.PhysicalDiskBytes == 0 || actual.PhysicalDiskBytes != expected.PhysicalDiskBytes {
		return fmt.Errorf("opened PhysicalDrive capacity changed: expected=%d actual=%d", expected.PhysicalDiskBytes, actual.PhysicalDiskBytes)
	}
	if actual.DeviceRemovable != expected.DeviceRemovable {
		return fmt.Errorf("opened PhysicalDrive removable identity changed: expected=%t actual=%t", expected.DeviceRemovable, actual.DeviceRemovable)
	}

	expectedSerial := strings.TrimSpace(expected.DeviceSerial)
	actualSerial := strings.TrimSpace(actual.DeviceSerial)
	if expectedSerial != actualSerial {
		return fmt.Errorf("opened PhysicalDrive device serial changed: expected=%q actual=%q", expectedSerial, actualSerial)
	}

	return nil
}
