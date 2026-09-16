//go:build windows && ordax_raw_backend

package windowsadapter

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

const portableDataSectorBytes = uint64(512)

// FormatPortableDataVolume runs only after the trusted raw write has completed
// its byte-for-byte readback proof and the raw-device lease has been released.
// The pre-write confirmation token intentionally includes volume identity, so
// it cannot be reused after the partition table has changed. Instead this
// boundary revalidates the exact physical disk number through the same native
// read-only PhysicalDrive identity primitive used during initial discovery.
func FormatPortableDataVolume(expected Target, dataStartLBA, dataBytes uint64) error {
	if expected.SystemDisk || !expected.PrototypeSafe || expected.ConfirmationToken == "" {
		return errors.New("portable data formatting requires a confirmed safe USB target")
	}
	if dataStartLBA == 0 || dataBytes == 0 || dataStartLBA > ^uint64(0)/portableDataSectorBytes {
		return errors.New("portable data geometry is invalid")
	}

	systemDisk, err := windowsSystemDiskNumber()
	if err != nil {
		return fmt.Errorf("re-establish Windows system disk before ORDAX-DATA format: %w", err)
	}
	if expected.DiskNumber == systemDisk {
		return errors.New("portable data formatting blocked: target now resolves to the Windows system disk")
	}
	busType, deviceRemovable, deviceSerial, diskBytes, err := physicalDeviceIdentity(expected.DiskNumber)
	if err != nil {
		return fmt.Errorf("revalidate PhysicalDrive%d before ORDAX-DATA format: %w", expected.DiskNumber, err)
	}
	if busType != BusTypeUSB {
		return errors.New("portable data formatting blocked: target is no longer a USB disk")
	}
	if diskBytes != expected.PhysicalDiskBytes {
		return errors.New("portable data formatting blocked: physical disk capacity changed")
	}
	if deviceRemovable != expected.DeviceRemovable {
		return errors.New("portable data formatting blocked: physical removable identity changed")
	}
	if serial := strings.TrimSpace(expected.DeviceSerial); serial != "" && strings.TrimSpace(deviceSerial) != serial {
		return errors.New("portable data formatting blocked: physical device serial changed")
	}

	offsetBytes := dataStartLBA * portableDataSectorBytes
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$diskNumber = %d
$expectedDiskBytes = [UInt64]%d
$expectedOffset = [UInt64]%d
$expectedDataBytes = [UInt64]%d

Update-HostStorageCache -ErrorAction SilentlyContinue
$disk = Get-Disk -Number $diskNumber -ErrorAction Stop
if ([UInt64]$disk.Size -ne $expectedDiskBytes) {
    throw "target disk size changed before ORDAX-DATA format"
}
if (([string]$disk.BusType).ToUpperInvariant() -ne 'USB') {
    throw "target disk is no longer reported as USB"
}
if ([bool]$disk.IsSystem -or [bool]$disk.IsBoot) {
    throw "refusing to format ORDAX-DATA on a Windows system/boot disk"
}

$partition = Get-Partition -DiskNumber $diskNumber -PartitionNumber 3 -ErrorAction Stop
if ([UInt64]$partition.Offset -ne $expectedOffset) {
    throw "ORDAX-DATA partition offset does not match the authorized layout"
}
if ([UInt64]$partition.Size -ne $expectedDataBytes) {
    throw "ORDAX-DATA partition size does not match the authorized layout"
}
$expectedType = '{EBD0A0A2-B9E5-4433-87C0-68B6B72699C7}'
if (([string]$partition.GptType).ToUpperInvariant() -ne $expectedType) {
    throw "ORDAX-DATA partition is not Microsoft Basic Data"
}

$volume = $partition | Get-Volume -ErrorAction SilentlyContinue
if ($null -eq $volume) {
    throw "Windows did not expose ORDAX-DATA as a format-capable volume"
}
$volume | Format-Volume -FileSystem exFAT -NewFileSystemLabel 'ORDAX-DATA' -Confirm:$false -Force | Out-Null
Start-Sleep -Milliseconds 250
Update-HostStorageCache -ErrorAction SilentlyContinue

$checkPartition = Get-Partition -DiskNumber $diskNumber -PartitionNumber 3 -ErrorAction Stop
if ([string]::IsNullOrWhiteSpace([string]$checkPartition.DriveLetter)) {
    $checkPartition | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction Stop
    Start-Sleep -Milliseconds 250
    Update-HostStorageCache -ErrorAction SilentlyContinue
    $checkPartition = Get-Partition -DiskNumber $diskNumber -PartitionNumber 3 -ErrorAction Stop
}
if ([string]::IsNullOrWhiteSpace([string]$checkPartition.DriveLetter)) {
    throw "ORDAX-DATA did not receive a Windows drive letter"
}

$checkVolume = $checkPartition | Get-Volume -ErrorAction Stop
if (([string]$checkVolume.FileSystemType) -ne 'exFAT') {
    throw "ORDAX-DATA filesystem verification failed"
}
if (([string]$checkVolume.FileSystemLabel) -ne 'ORDAX-DATA') {
    throw "ORDAX-DATA label verification failed"
}
`,
		expected.DiskNumber,
		expected.PhysicalDiskBytes,
		offsetBytes,
		dataBytes,
	)

	command := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command", script,
	)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("format ORDAX-DATA as exFAT: %s", message)
	}
	return nil
}
