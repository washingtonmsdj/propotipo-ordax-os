//go:build windows

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"

	appchannel "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/appchannel"
)

const launcherVersion = "1"

var (
	buildCanonicalTrustBase64 = "UNRESOLVED"
	buildCanonicalTrustSHA256 = "UNRESOLVED"

	user32              = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW     = user32.NewProc("MessageBoxW")
)

func trustBinding() ([]byte, string, error) {
	encoded := strings.TrimSpace(buildCanonicalTrustBase64)
	digest := strings.TrimSpace(buildCanonicalTrustSHA256)
	if encoded == "" || encoded == "UNRESOLVED" || digest == "" || digest == "UNRESOLVED" {
		return nil, "", fmt.Errorf("canonical Creator release trust is unresolved")
	}
	trust, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(trust) == 0 {
		return nil, "", fmt.Errorf("compiled canonical trust bytes are invalid")
	}
	return trust, digest, nil
}

func utf16Ptr(value string) *uint16 {
	ptr, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		return syscall.StringToUTF16Ptr("OrdaX Creator")
	}
	return ptr
}

func showError(err error) {
	message := "Não foi possível iniciar o OrdaX Creator.\n\n" + err.Error() + "\n\nNenhuma atualização não verificada foi executada."
	procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(message))),
		uintptr(unsafe.Pointer(utf16Ptr("OrdaX Creator"))),
		uintptr(0x00000010|0x00010000),
	)
}

func resolveApp() (appchannel.Installed, error) {
	trust, trustSHA, err := trustBinding()
	if err != nil {
		return appchannel.Installed{}, err
	}
	installed, _, err := appchannel.AcquireCached(nil, "", "", trust, trustSHA)
	if err == nil {
		return installed, nil
	}
	current, currentErr := appchannel.Current("", trust, trustSHA)
	if currentErr != nil {
		return appchannel.Installed{}, fmt.Errorf("signed app update failed (%v) and no last-known-good signed app is available (%v)", err, currentErr)
	}
	return current, nil
}

func launch(installed appchannel.Installed) error {
	command := exec.Command(installed.Executable, os.Args[1:]...)
	command.Dir = installed.Directory
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start verified Creator app %s: %w", installed.Version, err)
	}
	if command.Process != nil {
		_ = command.Process.Release()
	}
	return nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--launcher-version" {
		// This diagnostic is intentionally invisible in normal GUI use, but is
		// useful to publisher verification when the binary is launched from a
		// console before end-user publication.
		fmt.Printf("ORDAX_CREATOR_LAUNCHER_VERSION=%s\n", launcherVersion)
		return
	}
	installed, err := resolveApp()
	if err != nil {
		showError(err)
		os.Exit(1)
	}
	if err := launch(installed); err != nil {
		showError(err)
		os.Exit(1)
	}
}
