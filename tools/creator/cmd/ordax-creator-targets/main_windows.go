//go:build windows

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
)

func main() {
	confirm := flag.String("confirm", "", "re-enumerate and confirm one previously listed target token")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets: unexpected positional arguments")
		os.Exit(2)
	}

	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
		os.Exit(1)
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if *confirm == "" {
		output := struct {
			Schema        string                  `json:"$schema"`
			Mode          string                  `json:"mode"`
			PhysicalWrite bool                    `json:"physical_write"`
			Targets       []windowsadapter.Target `json:"targets"`
		}{
			Schema:        "prototype-ordax.creator-windows-targets/1",
			Mode:          "read-only-discovery",
			PhysicalWrite: false,
			Targets:       targets,
		}
		if err := encoder.Encode(output); err != nil {
			fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
			os.Exit(1)
		}
		return
	}

	target, err := windowsadapter.MatchConfirmedTarget(targets, *confirm)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
		os.Exit(1)
	}
	output := struct {
		Schema        string                `json:"$schema"`
		Mode          string                `json:"mode"`
		PhysicalWrite bool                  `json:"physical_write"`
		Confirmed     bool                  `json:"confirmed"`
		Target        windowsadapter.Target `json:"target"`
	}{
		Schema:        "prototype-ordax.creator-windows-target-confirmation/1",
		Mode:          "read-only-reenumeration-confirmation",
		PhysicalWrite: false,
		Confirmed:     true,
		Target:        target,
	}
	if err := encoder.Encode(output); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
		os.Exit(1)
	}
}
