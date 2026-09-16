//go:build windows && ordax_owner_prototype

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type ownerPrototypeProvenance struct {
	Schema       string `json:"$schema"`
	Status       string `json:"status"`
	SourceCommit string `json:"source_commit"`
}

func validOwnerSourceCommit(value string) bool {
	if len(value) != 40 || value != strings.ToLower(value) {
		return false
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}

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

// ownerPrototypeBuildInfo identifies the exact package currently running.
// This avoids displaying the unrelated creator-dev component version in the
// owner-only write-enabled package and gives the visible updater an immutable
// source commit to compare against.
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
		!validOwnerSourceCommit(provenance.SourceCommit) {
		return "", "", false
	}
	return "owner-" + provenance.SourceCommit[:12], provenance.SourceCommit, true
}
