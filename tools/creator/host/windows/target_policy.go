package windowsadapter

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	DriveTypeRemovable uint32 = 2
	DriveTypeFixed     uint32 = 3
	BusTypeUSB         uint32 = 7
)

type Target struct {
	DriveLetter       string `json:"drive_letter"`
	VolumeLabel       string `json:"volume_label"`
	VolumeSerial      uint32 `json:"volume_serial"`
	DiskNumber        uint32 `json:"disk_number"`
	VolumeBytes       uint64 `json:"volume_bytes"`
	DriveType         string `json:"drive_type"`
	BusType           string `json:"bus_type"`
	DeviceRemovable   bool   `json:"device_removable"`
	DeviceSerial      string `json:"device_serial,omitempty"`
	SystemDisk        bool   `json:"system_disk"`
	PrototypeSafe     bool   `json:"prototype_safe"`
	ConfirmationToken string `json:"confirmation_token"`
}

func driveTypeName(value uint32) string {
	switch value {
	case DriveTypeRemovable:
		return "removable"
	case DriveTypeFixed:
		return "fixed"
	default:
		return "other"
	}
}

func busTypeName(value uint32) string {
	if value == BusTypeUSB {
		return "usb"
	}
	return "other"
}

func IsPrototypeCandidate(driveLetter string, driveType uint32, mappedPhysicalDisk bool, busType uint32, systemDisk bool) bool {
	letter := strings.ToUpper(strings.TrimSpace(driveLetter))
	if !mappedPhysicalDisk || systemDisk || busType != BusTypeUSB {
		return false
	}
	if driveType != DriveTypeRemovable && driveType != DriveTypeFixed {
		return false
	}
	if len(letter) != 2 || letter[1] != ':' || letter[0] < 'A' || letter[0] > 'Z' {
		return false
	}
	return letter != "C:"
}

func ConfirmationToken(target Target) string {
	identity := fmt.Sprintf(
		"ordax-target-v2|%s|%08x|%d|%d|%s|%s|%t|%s|%t",
		strings.ToUpper(strings.TrimSpace(target.DriveLetter)),
		target.VolumeSerial,
		target.DiskNumber,
		target.VolumeBytes,
		target.DriveType,
		target.BusType,
		target.DeviceRemovable,
		strings.TrimSpace(target.DeviceSerial),
		target.SystemDisk,
	)
	digest := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(digest[:])
}

func FinalizeTarget(target Target, driveType uint32, mappedPhysicalDisk bool, busType uint32, systemDisk bool) Target {
	target.DriveType = driveTypeName(driveType)
	target.BusType = busTypeName(busType)
	target.SystemDisk = systemDisk
	target.PrototypeSafe = IsPrototypeCandidate(target.DriveLetter, driveType, mappedPhysicalDisk, busType, systemDisk)
	target.ConfirmationToken = ConfirmationToken(target)
	return target
}

func MatchConfirmedTarget(targets []Target, token string) (Target, error) {
	token = strings.ToLower(strings.TrimSpace(token))
	decoded, err := hex.DecodeString(token)
	if err != nil || len(decoded) != sha256.Size {
		return Target{}, errors.New("confirmation token must be lowercase 64-hex SHA-256")
	}
	var match *Target
	for i := range targets {
		candidate := targets[i]
		if !candidate.PrototypeSafe || candidate.ConfirmationToken != token {
			continue
		}
		if match != nil {
			return Target{}, errors.New("confirmation token matched multiple targets")
		}
		copy := candidate
		match = &copy
	}
	if match == nil {
		return Target{}, errors.New("confirmation token no longer matches a currently safe USB target")
	}
	return *match, nil
}
