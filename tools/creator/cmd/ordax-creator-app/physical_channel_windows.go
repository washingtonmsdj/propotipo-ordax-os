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

// resolvePhysicalBackend returns only a backend that came from the dedicated
// purpose-bound, Ed25519-signed physical channel. Online acquisition persists
// an offline pointer only after a second signed-envelope verification. Network
// failure can use that cached envelope, which is reverified and whose five
// critical files are rehashed before the backend is returned.
func resolvePhysicalBackend() (string, bool) {
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
