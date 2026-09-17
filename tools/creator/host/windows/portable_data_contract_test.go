package windowsadapter

import (
	"os"
	"strings"
	"testing"
)

func TestPortableDataWindowsWaitsForStableFormattedVolume(t *testing.T) {
	source, err := os.ReadFile("portable_data_windows.go")
	if err != nil {
		t.Fatalf("read portable_data_windows.go: %v", err)
	}
	text := string(source)
	required := []string{
		"$verificationDeadline = (Get-Date).AddSeconds(20)",
		"OrdinalIgnoreCase",
		"Get-Volume -DriveLetter",
		"Add-PartitionAccessPath -AssignDriveLetter",
		"ORDAX-DATA verification timed out: filesystem=",
		"$observedFileSystem = [string]$checkVolume.FileSystem",
		"$observedFileSystem = [string]$checkVolume.FileSystemType",
		"[System.IO.DriveInfo]::new",
		"$driveInfo.DriveFormat",
		"'Unknown'",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("portable ORDAX-DATA verification lost required stabilization fragment %q", fragment)
		}
	}

	fileSystemPos := strings.Index(text, "$observedFileSystem = [string]$checkVolume.FileSystem\n")
	fileSystemTypePos := strings.Index(text, "$observedFileSystem = [string]$checkVolume.FileSystemType\n")
	if fileSystemPos < 0 || fileSystemTypePos < 0 || fileSystemPos >= fileSystemTypePos {
		t.Fatalf("portable ORDAX-DATA verification must prefer FileSystem before FileSystemType; positions filesystem=%d filesystemType=%d", fileSystemPos, fileSystemTypePos)
	}

	forbidden := []string{
		"if (([string]$checkVolume.FileSystemType) -ne 'exFAT')",
		"throw \"ORDAX-DATA filesystem verification failed\"",
	}
	for _, fragment := range forbidden {
		if strings.Contains(text, fragment) {
			t.Fatalf("portable ORDAX-DATA verification regressed to one-shot check %q", fragment)
		}
	}
}
