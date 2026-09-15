package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const DriveTypeRemovable uint32 = 2

type Target struct {
	DriveLetter       string `json:"drive_letter"`
	VolumeLabel       string `json:"volume_label"`
	VolumeSerial      uint32 `json:"volume_serial"`
	DiskNumber        uint32 `json:"disk_number"`
	VolumeBytes       uint64 `json:"volume_bytes"`
	DriveType         string `json:"drive_type"`
	PrototypeSafe     bool   `json:"prototype_safe"`
	ConfirmationToken string `json:"confirmation_token"`
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

func ConfirmationToken(target Target) string {
	identity := fmt.Sprintf(
		"ordax-target-v1|%s|%08x|%d|%d|%s",
		strings.ToUpper(strings.TrimSpace(target.DriveLetter)),
		target.VolumeSerial,
		target.DiskNumber,
		target.VolumeBytes,
		target.DriveType,
	)
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func FinalizeTarget(target Target, driveType uint32, mappedPhysicalDisk bool) Target {
	target.PrototypeSafe = IsPrototypeCandidate(target.DriveLetter, driveType, mappedPhysicalDisk)
	target.ConfirmationToken = ConfirmationToken(target)
	return target
}
