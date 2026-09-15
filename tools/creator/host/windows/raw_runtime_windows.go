//go:build windows

package windowsadapter

// windowsRawDiskRuntimeUnbound assembles the native Windows pieces behind the
// already-tested rawDiskRuntime policy surface. The type is deliberately
// unexported and no CLI, desktop action or package API constructs it today.
// Merely implementing this interface does not authorize or execute a physical
// write; applyRawDiskInternal remains unexported and all public apply paths stay
// absent.
type windowsRawDiskRuntimeUnbound struct{}

var _ rawDiskRuntime = windowsRawDiskRuntimeUnbound{}

func (windowsRawDiskRuntimeUnbound) IsElevated() (bool, error) {
	return currentProcessElevated()
}

func (windowsRawDiskRuntimeUnbound) EnumerateTargets() ([]Target, error) {
	return EnumerateRemovableTargets()
}

func (windowsRawDiskRuntimeUnbound) AcquireTargetVolumeLease(expected Target) (rawVolumeLease, error) {
	return acquireTargetVolumeLeaseInternal(windowsTargetVolumeLeaseRuntime{}, expected)
}

func (windowsRawDiskRuntimeUnbound) OpenVerifiedPhysicalDrive(expected Target, lease rawVolumeLease) (rawDiskDevice, error) {
	return openVerifiedPhysicalDriveWritableUnbound(expected, lease)
}
