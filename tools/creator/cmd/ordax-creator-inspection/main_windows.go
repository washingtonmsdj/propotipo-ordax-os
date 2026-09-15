//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"

	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
	creatortrust "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/trust"
)

type buildBinding struct {
	SourceCommit            string `json:"source_commit"`
	CanonicalTrustSHA256    string `json:"canonical_trust_sha256"`
	ManifestSHA256          string `json:"manifest_sha256"`
	SeedImageSHA256         string `json:"seed_image_sha256"`
	SeedImageSize           int64  `json:"seed_image_size"`
	PhysicalWriteAuthorized bool   `json:"physical_write_authorized"`
	Ready                   bool   `json:"ready"`
}

func encode(value any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func runStatus() error {
	return encode(struct {
		Schema                  string       `json:"$schema"`
		Mode                    string       `json:"mode"`
		RawBackendLinked        bool         `json:"raw_backend_linked"`
		PublicCreatorUnaffected bool         `json:"public_creator_unaffected"`
		Build                   buildBinding `json:"build"`
	}{
		Schema:                  "prototype-ordax.creator-physical-test-status/2",
		Mode:                    "development-inspection-only",
		RawBackendLinked:        false,
		PublicCreatorUnaffected: true,
		Build: buildBinding{
			SourceCommit:            "UNRESOLVED",
			CanonicalTrustSHA256:    "UNRESOLVED",
			ManifestSHA256:          "UNRESOLVED",
			SeedImageSHA256:         "UNRESOLVED",
			SeedImageSize:           0,
			PhysicalWriteAuthorized: false,
			Ready:                   false,
		},
	})
}

func runTargets() error {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return err
	}
	return encode(struct {
		Schema  string                  `json:"$schema"`
		Mode    string                  `json:"mode"`
		Targets []windowsadapter.Target `json:"targets"`
	}{
		Schema:  "prototype-ordax.creator-physical-test-targets/1",
		Mode:    "read-only",
		Targets: targets,
	})
}

func runTrustStatus() error {
	status, err := creatortrust.Inspect()
	if err != nil {
		return err
	}
	return encode(status)
}

func runTrustInit() error {
	status, err := creatortrust.Initialize()
	if err != nil {
		return err
	}
	return encode(status)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-creator-inspection <status|targets|trust-status|trust-init>")
}

func main() {
	if len(os.Args) != 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "status":
		err = runStatus()
	case "targets":
		err = runTargets()
	case "trust-status":
		err = runTrustStatus()
	case "trust-init":
		err = runTrustInit()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-inspection:", err)
		os.Exit(1)
	}
}
