package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	creatorupdate "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/update"
)

const bootstrapVersion = "1"

func usage() {
	fmt.Fprintln(os.Stderr, "usage: OrdaX-Creator.exe [inspect|trust|status|targets|update|version]")
}

func resolveCurrent() (creatorupdate.Installed, bool, error) {
	installed, changed, err := creatorupdate.Ensure(nil, "", "")
	if err == nil {
		return installed, changed, nil
	}
	current, currentErr := creatorupdate.Current("")
	if currentErr != nil {
		return creatorupdate.Installed{}, false, fmt.Errorf("update failed and no valid installed Creator is available: %w", err)
	}
	fmt.Fprintf(os.Stderr, "OrdaX Creator: update unavailable; using last valid version %s (%s): %v\n", current.Version, current.SourceCommit[:12], err)
	return current, false, nil
}

func runCMD(directory, name string) error {
	if runtime.GOOS != "windows" {
		return errors.New("Creator interactive launch is currently supported only on Windows")
	}
	path := filepath.Join(directory, name)
	cmd := exec.Command("cmd.exe", "/d", "/c", path)
	cmd.Dir = directory
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runPhysical(directory, command string) error {
	if runtime.GOOS != "windows" {
		return errors.New("Creator physical inspection is currently supported only on Windows")
	}
	path := filepath.Join(directory, "ordax-creator-physical-test.exe")
	cmd := exec.Command(path, command)
	cmd.Dir = directory
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func main() {
	command := "inspect"
	if len(os.Args) > 2 {
		usage()
		os.Exit(2)
	}
	if len(os.Args) == 2 {
		command = os.Args[1]
	}
	if command == "version" {
		fmt.Printf("ORDAX_CREATOR_BOOTSTRAP_VERSION=%s\n", bootstrapVersion)
		if current, err := creatorupdate.Current(""); err == nil {
			fmt.Printf("INSTALLED_VERSION=%s\nSOURCE_COMMIT=%s\n", current.Version, current.SourceCommit)
		} else {
			fmt.Printf("INSTALLED_VERSION=NONE\n")
		}
		return
	}
	if command != "inspect" && command != "trust" && command != "status" && command != "targets" && command != "update" {
		usage()
		os.Exit(2)
	}

	installed, changed, err := resolveCurrent()
	if err != nil {
		fmt.Fprintln(os.Stderr, "OrdaX Creator:", err)
		os.Exit(1)
	}
	if changed {
		fmt.Printf("CREATOR_UPDATED=YES\nVERSION=%s\nSOURCE_COMMIT=%s\n", installed.Version, installed.SourceCommit)
	} else {
		fmt.Printf("CREATOR_UPDATED=NO\nVERSION=%s\nSOURCE_COMMIT=%s\n", installed.Version, installed.SourceCommit)
	}
	if command == "update" {
		return
	}

	switch command {
	case "inspect":
		err = runCMD(installed.Directory, "1-Inspect-OrdaXUSB.cmd")
	case "trust":
		err = runCMD(installed.Directory, "2-Initialize-OrdaXTrust.cmd")
	case "status", "targets":
		err = runPhysical(installed.Directory, command)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "OrdaX Creator:", err)
		os.Exit(1)
	}
}
