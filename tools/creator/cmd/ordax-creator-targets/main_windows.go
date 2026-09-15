//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"

	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
)

func main() {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
		os.Exit(1)
	}
	output := struct {
		Schema         string                  `json:"$schema"`
		Mode           string                  `json:"mode"`
		PhysicalWrite  bool                    `json:"physical_write"`
		Targets        []windowsadapter.Target `json:"targets"`
	}{
		Schema:        "prototype-ordax.creator-windows-targets/1",
		Mode:          "read-only-discovery",
		PhysicalWrite: false,
		Targets:       targets,
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(output); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-targets:", err)
		os.Exit(1)
	}
}
