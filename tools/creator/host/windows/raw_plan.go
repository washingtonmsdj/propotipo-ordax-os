package windowsadapter

import "fmt"

type RawDiskWritePlan struct {
	Schema                        string   `json:"$schema"`
	Status                        string   `json:"status"`
	Strategy                      string   `json:"strategy"`
	PhysicalPath                  string   `json:"physical_path"`
	PhysicalWriteImplemented      bool     `json:"physical_write_implemented"`
	PhysicalWriteAuthorized       bool     `json:"physical_write_authorized"`
	RequiresElevation             bool     `json:"requires_elevation"`
	RequiresCanonicalTrust        bool     `json:"requires_canonical_trust"`
	RequiresExplicitAuthorization bool     `json:"requires_explicit_destructive_authorization"`
	Target                        Target   `json:"target"`
	Preconditions                 []string `json:"preconditions"`
	FutureOperations              []string `json:"future_operations"`
}

// BuildBlockedRawDiskWritePlan turns a currently re-enumerated, safe USB target
// into an explicit future-write plan. It never opens the physical disk and it
// deliberately reports physical write as both unimplemented and unauthorized.
func BuildBlockedRawDiskWritePlan(target Target, confirmationToken string) (RawDiskWritePlan, error) {
	confirmed, err := MatchConfirmedTarget([]Target{target}, confirmationToken)
	if err != nil {
		return RawDiskWritePlan{}, err
	}
	if confirmed.SystemDisk || confirmed.BusType != "usb" || !confirmed.PrototypeSafe {
		return RawDiskWritePlan{}, fmt.Errorf("target is not eligible for a raw-disk plan")
	}
	return RawDiskWritePlan{
		Schema:                        "prototype-ordax.creator-windows-raw-disk-plan/1",
		Status:                        "blocked",
		Strategy:                      "verified-full-disk-image",
		PhysicalPath:                  fmt.Sprintf(`\\.\PhysicalDrive%d`, confirmed.DiskNumber),
		PhysicalWriteImplemented:      false,
		PhysicalWriteAuthorized:       false,
		RequiresElevation:             true,
		RequiresCanonicalTrust:        true,
		RequiresExplicitAuthorization: true,
		Target:                        confirmed,
		Preconditions: []string{
			"target-reenumerated-and-confirmation-token-matched",
			"physicaldrive-transport-proven-usb",
			"windows-system-disk-excluded",
			"creator-payload-byte-complete-and-hash-verified",
			"canonical-release-trust-resolved",
			"full-disk-image-verified-before-open",
			"explicit-destructive-authorization-collected-at-apply-boundary",
		},
		FutureOperations: []string{
			"open-confirmed-physicaldrive-exclusively-with-write-access",
			"lock-and-dismount-target-volumes",
			"stream-verified-full-disk-image",
			"flush-device-buffers",
			"re-read-and-verify-gpt-and-critical-payload-regions",
			"release-volume-locks-and-close-device",
		},
	}, nil
}
