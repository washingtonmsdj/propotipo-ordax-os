//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "OrdaX Creator stable launcher is currently supported only on Windows")
	os.Exit(1)
}
