package windowsadapter

import "strings"

const DriveTypeRemovable uint32 = 2

type Target struct {
	DriveLetter   string `json:"drive_letter"`
	VolumeLabel   string `json:"volume_label"`
	DiskNumber    uint32 `json:"disk_number"`
	VolumeBytes   uint64 `json:"volume_bytes"`
	DriveType     string `json:"drive_type"`
	PrototypeSafe bool   `json:"prototype_safe"`
}

func IsPrototypeCandidate(driveLetter string, driveType uint32, mappedPhysicalDisk bool) bool {
	letter := strings.ToUpper(strings.TrimSpace(driveLetter))
	if !mappedPhysicalDisk || driveType != DriveTypeRemovable {
		return false
	}
	if len(letter) != 2 || letter[1] != ':' || letter[0] < 'A' || letter[0] > 'Z' {
		return false
	}
	return letter != "C:"
}
