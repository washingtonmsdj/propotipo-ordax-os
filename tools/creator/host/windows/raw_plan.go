package windowsadapter

import "fmt"

type RawDiskWritePlan struct {
	Schema                         string   `json:"$schema"`
	Status                         string   `json:"status"`
	Strategy                       string   `json:"strategy"`
	PhysicalPath                   string   `json:"physical_path"`
	NativeBackendImplemented       bool     `json:"native_backend_implemented"`
	PublicPhysicalApplyImplemented bool     `json:"public_physical_apply_implemented"`
	PhysicalWriteAuthorized        bool     `json:"physical_write_authorized"`
	RequiresElevation              bool     `json:"requires_elevation"`
	RequiresCanonicalTrust         bool     `json:"requires_canonical_trust"`
	RequiresExplicitAuthorization  bool     `json:"requires_explicit_destructive_authorization"`
	Target                         Target   `json:"target"`
	Preconditions                  []string `json:"preconditions"`
	BlockedUntil                   []string `json:"blocked_until"`
}

// BuildBlockedRawDiskWritePlan turns a currently re-enumerated, safe USB target
// into an explicit blocked physical-write plan. The native Windows backend now
// exists in source behind unexported boundaries, so the plan distinguishes that
// fact from public reachability and authorization. Building this plan never
// opens, locks, dismounts or writes a physical device.
func BuildBlockedRawDiskWritePlan(target Target, confirmationToken string) (RawDiskWritePlan, error) {
	confirmed, err := MatchConfirmedTarget([]Target{target}, confirmationToken)
	if err != nil {
		return RawDiskWritePlan{}, err
	}
	if confirmed.SystemDisk || confirmed.BusType != "usb" || !confirmed.PrototypeSafe || confirmed.PhysicalDiskBytes == 0 {
		return RawDiskWritePlan{}, fmt.Errorf("target is not eligible for a raw-disk plan")
	}
	return RawDiskWritePlan{
		Schema:                         "prototype-ordax.creator-windows-raw-disk-plan/2",
		Status:                         "blocked",
		Strategy:                       "verified-full-disk-image",
		PhysicalPath:                   fmt.Sprintf(`\\.\PhysicalDrive%d`, confirmed.DiskNumber),
		NativeBackendImplemented:       true,
		PublicPhysicalApplyImplemented: false,
		PhysicalWriteAuthorized:        false,
		RequiresElevation:              true,
		RequiresCanonicalTrust:         true,
		RequiresExplicitAuthorization:  true,
		Target:                         confirmed,
		Preconditions: []string{
			"target-reenumerated-and-confirmation-token-matched",
			"physicaldrive-transport-proven-usb",
			"physical-disk-capacity-measured",
			"windows-system-disk-excluded",
			"creator-payload-byte-complete-and-hash-verified",
			"canonical-release-trust-resolved",
			"full-disk-image-verified-before-open",
			"full-disk-image-size-equals-physical-device",
			"all-target-volumes-isolated-to-confirmed-physicaldrive",
			"all-target-volumes-locked-and-dismounted-under-managed-lease",
			"writable-physicaldrive-identity-reproved-on-same-handle",
			"explicit-destructive-authorization-collected-at-apply-boundary",
		},
		BlockedUntil: []string{
			"canonical-release-trust-is-pinned",
			"byte-complete-bootstrap-media-proof-passes-with-canonical-trust",
			"public-physical-apply-boundary-is-explicitly-implemented",
			"user-explicitly-authorizes-the-exact-destructive-operation",
		},
	}, nil
}
