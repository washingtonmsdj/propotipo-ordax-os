//go:build windows

package main

import (
	"fmt"
	"os"
)

func launcherHealthCheck() error {
	for name, dll := range map[string]interface{ Load() error }{
		"user32.dll":   user32,
		"kernel32.dll": kernel32,
		"gdi32.dll":    gdi32,
	} {
		if err := dll.Load(); err != nil {
			return fmt.Errorf("load %s: %w", name, err)
		}
	}
	instance, _, _ := procGetModuleHandleW.Call(0)
	if instance == 0 {
		return fmt.Errorf("GetModuleHandleW returned a null module handle")
	}
	return nil
}

// The stable launcher invokes this mode only for a newly downloaded signed
// Creator app. It proves that the executable can start on this Windows host and
// resolve the native DLL surface needed by the GUI before the update is made
// current. It performs no network access and touches no removable media.
func init() {
	if len(os.Args) != 2 || os.Args[1] != "--launcher-healthcheck" {
		return
	}
	if err := launcherHealthCheck(); err != nil {
		fmt.Fprintf(os.Stderr, "ORDAX_CREATOR_APP_HEALTH=FAIL error=%v\n", err)
		os.Exit(1)
	}
	fmt.Println("ORDAX_CREATOR_APP_HEALTH=PASS")
	os.Exit(0)
}
