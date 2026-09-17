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

function Refresh-OrdaXStorage {
    Update-HostStorageCache -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}

function Get-OrdaXDataPartition {
    return Get-Partition -DiskNumber $diskNumber -PartitionNumber 3 -ErrorAction Stop
}

Refresh-OrdaXStorage
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

$partition = $null
$partitionDeadline = (Get-Date).AddSeconds(20)
do {
    try {
        $partition = Get-OrdaXDataPartition
    } catch {
        $partition = $null
    }
    if ($null -eq $partition) {
        Refresh-OrdaXStorage
    }
} while ($null -eq $partition -and (Get-Date) -lt $partitionDeadline)
if ($null -eq $partition) {
    throw "Windows did not expose the new ORDAX-DATA partition within 20 seconds"
}

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

$volume = $null
$volumeDeadline = (Get-Date).AddSeconds(20)
do {
    try {
        $volume = $partition | Get-Volume -ErrorAction Stop
    } catch {
        $volume = $null
    }
    if ($null -eq $volume) {
        Refresh-OrdaXStorage
        try {
            $partition = Get-OrdaXDataPartition
        } catch {
            $partition = $null
        }
    }
} while ($null -eq $volume -and (Get-Date) -lt $volumeDeadline)
if ($null -eq $volume) {
    throw "Windows did not expose ORDAX-DATA as a format-capable volume within 20 seconds"
}

$formattedVolume = $volume | Format-Volume -FileSystem exFAT -NewFileSystemLabel 'ORDAX-DATA' -Confirm:$false -Force -ErrorAction Stop
if ($null -eq $formattedVolume) {
    throw "Format-Volume did not return the finalized ORDAX-DATA volume"
}

# Windows storage metadata can remain stale for several seconds on slower USB
# controllers after Format-Volume succeeds. Re-query the partition and volume
# until filesystem, label and drive letter converge instead of treating the
# first stale Get-Volume result as a failed installation.
$verificationDeadline = (Get-Date).AddSeconds(20)
$verified = $false
$observedFileSystem = ''
$observedLabel = ''
$observedDriveLetter = ''
do {
    Refresh-OrdaXStorage
    try {
        $checkPartition = Get-OrdaXDataPartition
        if ([string]::IsNullOrWhiteSpace([string]$checkPartition.DriveLetter)) {
            try {
                $checkPartition | Add-PartitionAccessPath -AssignDriveLetter -ErrorAction Stop
            } catch {
                # The mount manager can reject assignment while the freshly
                # formatted volume is still being published. Retry below.
            }
            Refresh-OrdaXStorage
            $checkPartition = Get-OrdaXDataPartition
        }

        $observedDriveLetter = [string]$checkPartition.DriveLetter
        $checkVolume = $null
        if (-not [string]::IsNullOrWhiteSpace($observedDriveLetter)) {
            try {
                $checkVolume = Get-Volume -DriveLetter $observedDriveLetter -ErrorAction Stop
            } catch {
                $checkVolume = $null
            }
        }
        if ($null -eq $checkVolume) {
            try {
                $checkVolume = $checkPartition | Get-Volume -ErrorAction Stop
            } catch {
                $checkVolume = $null
            }
        }

        if ($null -ne $checkVolume) {
            # FileSystemType can legitimately remain the enum value Unknown on
            # some Windows/storage-driver combinations even after Format-Volume
            # completed and FileSystem already reports exFAT. Prefer FileSystem,
            # treat Unknown as unresolved metadata, then fall back to DriveInfo.
            $observedFileSystem = [string]$checkVolume.FileSystem
            if ([string]::IsNullOrWhiteSpace($observedFileSystem) -or [string]::Equals($observedFileSystem.Trim(), 'Unknown', [System.StringComparison]::OrdinalIgnoreCase)) {
                $observedFileSystem = [string]$checkVolume.FileSystemType
            }
            if (([string]::IsNullOrWhiteSpace($observedFileSystem) -or [string]::Equals($observedFileSystem.Trim(), 'Unknown', [System.StringComparison]::OrdinalIgnoreCase)) -and -not [string]::IsNullOrWhiteSpace($observedDriveLetter)) {
                try {
                    $driveInfo = [System.IO.DriveInfo]::new(($observedDriveLetter + ':\'))
                    if ($driveInfo.IsReady) {
                        $observedFileSystem = [string]$driveInfo.DriveFormat
                    }
                } catch {
                    # Keep retrying until the mount manager exposes a ready drive.
                }
            }
            $observedLabel = [string]$checkVolume.FileSystemLabel
            $filesystemReady = [string]::Equals($observedFileSystem.Trim(), 'exFAT', [System.StringComparison]::OrdinalIgnoreCase)
            $labelReady = [string]::Equals($observedLabel.Trim(), 'ORDAX-DATA', [System.StringComparison]::OrdinalIgnoreCase)
            $driveReady = -not [string]::IsNullOrWhiteSpace($observedDriveLetter)
            $verified = $filesystemReady -and $labelReady -and $driveReady
        }
    } catch {
        $verified = $false
    }
} while (-not $verified -and (Get-Date) -lt $verificationDeadline)

if (-not $verified) {
    throw ("ORDAX-DATA verification timed out: filesystem='{0}' label='{1}' drive='{2}'" -f $observedFileSystem, $observedLabel, $observedDriveLetter)
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
