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
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("portable ORDAX-DATA verification lost required stabilization fragment %q", fragment)
		}
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
