//go:build windows

package main

import (
	"encoding/base64"
	"strings"

	physicalchannel "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/physicalchannel"
)

// These values are compile-time publisher bindings. Development builds keep
// them UNRESOLVED and therefore can never acquire or enable a destructive
// backend. End users never configure keys or trust material.
var (
	buildPhysicalTrustBase64 = "UNRESOLVED"
	buildPhysicalTrustSHA256 = "UNRESOLVED"
)

func physicalTrustBinding() ([]byte, string, bool) {
	encoded := strings.TrimSpace(buildPhysicalTrustBase64)
	digest := strings.TrimSpace(buildPhysicalTrustSHA256)
	if encoded == "" || encoded == "UNRESOLVED" || digest == "" || digest == "UNRESOLVED" {
		return nil, "", false
	}
	trust, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(trust) == 0 {
		return nil, "", false
	}
	return trust, digest, true
}

// resolvePhysicalBackend has two deliberately separate paths:
//  1. owner-prototype builds compiled with ordax_owner_prototype may use only
//     the raw backend and seed shipped beside that exact executable;
//  2. normal builds accept only the dedicated purpose-bound Ed25519-signed
//     physical channel.
//
// The special owner path is compile-time isolated. The ordinary creator-dev
// build does not contain it and therefore remains non-destructive.
func resolvePhysicalBackend() (string, bool) {
	if directory, ok := ownerPrototypePhysicalBackend(); ok {
		return directory, true
	}

	trust, trustSHA, ok := physicalTrustBinding()
	if !ok {
		return "", false
	}
	installed, _, err := physicalchannel.AcquireCached(nil, "", "", trust, trustSHA)
	if err == nil {
		return installed.Directory, true
	}
	current, currentErr := physicalchannel.Current("", trust, trustSHA)
	if currentErr != nil {
		return "", false
	}
	return current.Directory, true
}
