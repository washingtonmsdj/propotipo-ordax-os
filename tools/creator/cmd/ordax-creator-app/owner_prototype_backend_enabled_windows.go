//go:build windows && ordax_owner_prototype

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type ownerPrototypeProvenance struct {
	Schema                          string `json:"$schema"`
	Status                          string `json:"status"`
	SourceCommit                    string `json:"source_commit"`
	CanonicalPublicRelease          bool   `json:"canonical_public_release"`
	EphemeralPrototypeTrust         bool   `json:"ephemeral_prototype_trust"`
	PrivateKeyInPackage             bool   `json:"private_key_in_package"`
	RawBackendLinked                bool   `json:"raw_backend_linked"`
	PhysicalWriteAuthorizedInBinary bool   `json:"physical_write_authorized_in_binary"`
	SystemDiskExclusionRequired     bool   `json:"system_disk_exclusion_required"`
	LiveTargetRevalidationRequired  bool   `json:"live_target_revalidation_required"`
	WindowsUACRequired              bool   `json:"windows_uac_required"`
	ReadbackVerificationRequired    bool   `json:"readback_verification_required"`
	TrustSHA256                     string `json:"trust_sha256"`
	PrototypeManifestSHA256         string `json:"prototype_manifest_sha256"`
	SeedSHA256                      string `json:"seed_sha256"`
	SeedSize                        int64  `json:"seed_size"`
}

func validOwnerHex(value string, size int) bool {
	if len(value) != size || value != strings.ToLower(value) {
		return false
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}

func validOwnerSourceCommit(value string) bool { return validOwnerHex(value, 40) }

func ownerPrototypeDirectory() (string, bool) {
	executable, err := os.Executable()
	if err != nil {
		return "", false
	}
	directory := filepath.Dir(executable)
	for _, name := range []string{"ordax-creator-physical-test.exe", "ordax-bootstrap-seed.raw", "provenance.json"} {
		info, err := os.Lstat(filepath.Join(directory, name))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return "", false
		}
	}
	return directory, true
}

// ownerPrototypePhysicalBackend is intentionally available only in builds
// compiled with the ordax_owner_prototype tag. It never scans arbitrary paths:
// the executable, raw backend, seed image and provenance must be regular
// non-symlink files in the exact same directory.
func ownerPrototypePhysicalBackend() (string, bool) {
	return ownerPrototypeDirectory()
}

// ownerPrototypeBuildInfo identifies the exact package currently running and
// validates the safety promises bound into its provenance before presenting it
// as a write-enabled owner build.
func ownerPrototypeBuildInfo() (version string, sourceCommit string, ok bool) {
	directory, ok := ownerPrototypeDirectory()
	if !ok {
		return "", "", false
	}
	data, err := os.ReadFile(filepath.Join(directory, "provenance.json"))
	if err != nil {
		return "", "", false
	}
	var provenance ownerPrototypeProvenance
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&provenance); err != nil {
		return "", "", false
	}
	if provenance.Schema != "prototype-ordax.creator-owner-physical/1" ||
		provenance.Status != "owner-prototype-write-enabled" ||
		!validOwnerSourceCommit(provenance.SourceCommit) ||
		provenance.CanonicalPublicRelease ||
		!provenance.EphemeralPrototypeTrust ||
		provenance.PrivateKeyInPackage ||
		!provenance.RawBackendLinked ||
		!provenance.PhysicalWriteAuthorizedInBinary ||
		!provenance.SystemDiskExclusionRequired ||
		!provenance.LiveTargetRevalidationRequired ||
		!provenance.WindowsUACRequired ||
		!provenance.ReadbackVerificationRequired ||
		!validOwnerHex(provenance.TrustSHA256, 64) ||
		!validOwnerHex(provenance.PrototypeManifestSHA256, 64) ||
		!validOwnerHex(provenance.SeedSHA256, 64) ||
		provenance.SeedSize <= 0 {
		return "", "", false
	}
	return "owner-" + provenance.SourceCommit[:12], provenance.SourceCommit, true
}
