//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "ordax-creator-targets: Windows-only read-only target discovery")
	os.Exit(2)
}
