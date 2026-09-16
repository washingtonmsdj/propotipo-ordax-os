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

func powershellSingleQuoted(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

// FormatPortableDataVolume runs only after the trusted raw write has completed
// its byte-for-byte readback proof and the raw-device lease has been released.
// It re-confirms the exact USB identity, verifies partition 3 geometry, formats
// only that partition as exFAT, assigns a normal Windows drive letter, and
// verifies the resulting filesystem identity before the Creator may succeed.
func FormatPortableDataVolume(expected Target, dataStartLBA, dataBytes uint64) error {
	if expected.SystemDisk || !expected.PrototypeSafe || expected.ConfirmationToken == "" {
		return errors.New("portable data formatting requires a confirmed safe USB target")
	}
	if dataStartLBA == 0 || dataBytes == 0 || dataStartLBA > ^uint64(0)/portableDataSectorBytes {
		return errors.New("portable data geometry is invalid")
	}
	liveTargets, err := EnumerateRemovableTargets()
	if err != nil {
		return fmt.Errorf("re-enumerate USB before ORDAX-DATA format: %w", err)
	}
	confirmed, err := MatchConfirmedTarget(liveTargets, expected.ConfirmationToken)
	if err != nil {
		return fmt.Errorf("re-confirm USB before ORDAX-DATA format: %w", err)
	}
	if confirmed.DiskNumber != expected.DiskNumber || confirmed.PhysicalDiskBytes != expected.PhysicalDiskBytes {
		return errors.New("USB identity changed before ORDAX-DATA format")
	}

	offsetBytes := dataStartLBA * portableDataSectorBytes
	serial := strings.TrimSpace(confirmed.DeviceSerial)
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$diskNumber = %d
$expectedDiskBytes = [UInt64]%d
$expectedOffset = [UInt64]%d
$expectedDataBytes = [UInt64]%d
$expectedSerial = %s

Update-HostStorageCache -ErrorAction SilentlyContinue
$disk = Get-Disk -Number $diskNumber -ErrorAction Stop
if ([UInt64]$disk.Size -ne $expectedDiskBytes) {
    throw "target disk size changed before ORDAX-DATA format"
}
$diskSerial = ([string]$disk.SerialNumber).Trim()
if ($expectedSerial.Length -gt 0 -and $diskSerial.Length -gt 0 -and $diskSerial -ne $expectedSerial) {
    throw "target disk serial changed before ORDAX-DATA format"
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
		confirmed.DiskNumber,
		confirmed.PhysicalDiskBytes,
		offsetBytes,
		dataBytes,
		powershellSingleQuoted(serial),
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
