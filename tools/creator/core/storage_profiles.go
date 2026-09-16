package creatorcore

import "errors"

const (
	portableTargetESPBytes = uint64(512 * 1024 * 1024)
	nativeTargetESPBytes   = uint64(1024 * 1024 * 1024)
	portableTargetMinData = uint64(1024 * 1024 * 1024)
)

// TargetStorageProfile is pure target geometry. It deliberately contains no
// formatting or destructive I/O and is safe to use while the existing physical
// boot proof remains on the transitional layout.
type TargetStorageProfile struct {
	Profile     string `json:"profile"`
	TargetBytes uint64 `json:"target_bytes"`

	ESPStartLBA uint64 `json:"esp_start_lba"`
	ESPLastLBA  uint64 `json:"esp_last_lba"`
	ESPBytes    uint64 `json:"esp_bytes"`

	PayloadName     string `json:"payload_name"`
	PayloadStartLBA uint64 `json:"payload_start_lba"`
	PayloadLastLBA  uint64 `json:"payload_last_lba"`
	PayloadBytes    uint64 `json:"payload_bytes"`

	LastUsableLBA uint64 `json:"last_usable_lba"`
}

func planSharedCapacityProfile(targetBytes, espBytes uint64, profile, payloadName string) (TargetStorageProfile, error) {
	if targetBytes == 0 || targetBytes%storageSectorBytes != 0 {
		return TargetStorageProfile{}, errors.New("target capacity must be positive and 512-byte aligned")
	}
	if espBytes == 0 || espBytes%storageSectorBytes != 0 {
		return TargetStorageProfile{}, errors.New("ESP capacity must be positive and sector aligned")
	}

	targetSectors := targetBytes / storageSectorBytes
	if targetSectors <= storageGPTTailSectors+storageESPStartLBA {
		return TargetStorageProfile{}, errors.New("target is too small for GPT storage profile")
	}
	lastUsable := targetSectors - storageGPTTailSectors - 1

	espSectors := espBytes / storageSectorBytes
	if storageESPStartLBA > ^uint64(0)-(espSectors-1) {
		return TargetStorageProfile{}, errors.New("ESP geometry overflow")
	}
	espLast := storageESPStartLBA + espSectors - 1
	payloadStart, err := alignUp(espLast+1, storageAlignmentLBA)
	if err != nil {
		return TargetStorageProfile{}, err
	}
	if payloadStart > lastUsable {
		return TargetStorageProfile{}, errors.New("target has no usable shared-capacity payload area")
	}
	payloadSectors := lastUsable - payloadStart + 1
	if payloadSectors > ^uint64(0)/storageSectorBytes {
		return TargetStorageProfile{}, errors.New("payload capacity overflow")
	}

	return TargetStorageProfile{
		Profile:         profile,
		TargetBytes:     targetBytes,
		ESPStartLBA:     storageESPStartLBA,
		ESPLastLBA:      espLast,
		ESPBytes:        espBytes,
		PayloadName:     payloadName,
		PayloadStartLBA: payloadStart,
		PayloadLastLBA:  lastUsable,
		PayloadBytes:    payloadSectors * storageSectorBytes,
		LastUsableLBA:   lastUsable,
	}, nil
}

// PlanPortableTargetStorage implements the long-term portable USB physical
// boundary: ORDAX-ESP plus one shared ORDAX-DATA capacity area. The immutable
// OS release and Linux-native persistent-state image live as files inside the
// data area; there is no fixed-size physical system partition.
func PlanPortableTargetStorage(targetBytes uint64) (TargetStorageProfile, error) {
	layout, err := planSharedCapacityProfile(
		targetBytes,
		portableTargetESPBytes,
		"portable-usb",
		"ORDAX-DATA",
	)
	if err != nil {
		return TargetStorageProfile{}, err
	}
	if layout.PayloadBytes < portableTargetMinData {
		return TargetStorageProfile{}, errors.New("portable target leaves less than 1 GiB for ORDAX-DATA")
	}
	return layout, nil
}

// PlanNativeDiskTargetStorage implements the long-term installed-disk physical
// boundary: ORDAX-ESP plus one shared ORDAX-POOL capacity area. Filesystem,
// encryption, subvolumes and transactional deployments are layered inside the
// pool rather than represented by fixed-size system/home/app partitions.
func PlanNativeDiskTargetStorage(targetBytes uint64) (TargetStorageProfile, error) {
	return planSharedCapacityProfile(
		targetBytes,
		nativeTargetESPBytes,
		"native-disk",
		"ORDAX-POOL",
	)
}
