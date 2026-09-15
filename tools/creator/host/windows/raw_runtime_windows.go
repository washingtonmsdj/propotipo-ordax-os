//go:build windows && ordax_raw_backend

package windowsadapter

// windowsRawDiskRuntimeUnbound assembles the native Windows pieces behind the
// already-tested rawDiskRuntime policy surface. It is compiled only when the
// explicit ordax_raw_backend tag is selected. The type remains unexported and
// no CLI, desktop action or package API constructs it today.
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
