//go:build windows

package main

import "testing"

func TestLauncherHealthCheckLoadsRequiredWindowsSurface(t *testing.T) {
	if err := launcherHealthCheck(); err != nil {
		t.Fatal(err)
	}
}
