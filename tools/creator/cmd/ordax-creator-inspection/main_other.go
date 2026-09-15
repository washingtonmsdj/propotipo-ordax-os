//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "ordax-creator-inspection: Windows-only")
	os.Exit(1)
}
