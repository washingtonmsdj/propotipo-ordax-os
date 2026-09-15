//go:build !windows || !ordax_raw_backend

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "ordax-creator-physical-test: unavailable; requires Windows plus explicit ordax_raw_backend build")
	os.Exit(2)
}
