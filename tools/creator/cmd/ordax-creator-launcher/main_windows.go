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

const launcherVersion = "2"
const createNoWindow = 0x08000000

var (
	buildCanonicalTrustBase64 = "UNRESOLVED"
	buildCanonicalTrustSHA256 = "UNRESOLVED"

	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
)

type appResolution struct {
	Installed appchannel.Installed
	Pending   bool
	Trust     []byte
	TrustSHA  string
}

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

func resolveApp() (appResolution, error) {
	trust, trustSHA, err := trustBinding()
	if err != nil {
		return appResolution{}, err
	}
	installed, pending, err := appchannel.AcquirePending(nil, "", "", trust, trustSHA)
	if err == nil {
		return appResolution{Installed: installed, Pending: pending, Trust: trust, TrustSHA: trustSHA}, nil
	}
	current, currentErr := appchannel.LastKnownGood("", trust, trustSHA)
	if currentErr != nil {
		return appResolution{}, fmt.Errorf("signed app update failed (%v) and no last-known-good signed app is available (%v)", err, currentErr)
	}
	return appResolution{Installed: current, Pending: false, Trust: trust, TrustSHA: trustSHA}, nil
}

func healthCheck(installed appchannel.Installed) error {
	command := exec.Command(installed.Executable, "--launcher-healthcheck")
	command.Dir = installed.Directory
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("Creator app startup health-check failed: %w", err)
	}
	if !strings.Contains(string(output), "ORDAX_CREATOR_APP_HEALTH=PASS") {
		return fmt.Errorf("Creator app startup health-check did not return the required proof marker")
	}
	return nil
}

func start(installed appchannel.Installed) error {
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

func launch(resolution appResolution) error {
	if !resolution.Pending {
		return start(resolution.Installed)
	}
	if err := healthCheck(resolution.Installed); err != nil {
		_ = appchannel.DiscardPending("")
		fallback, fallbackErr := appchannel.LastKnownGood("", resolution.Trust, resolution.TrustSHA)
		if fallbackErr != nil {
			return fmt.Errorf("new signed Creator app was rejected before activation (%v); no last-known-good app is available (%v)", err, fallbackErr)
		}
		return start(fallback)
	}
	promoted, err := appchannel.PromotePending("", resolution.Installed.SourceCommit, resolution.Trust, resolution.TrustSHA)
	if err != nil {
		_ = appchannel.DiscardPending("")
		fallback, fallbackErr := appchannel.LastKnownGood("", resolution.Trust, resolution.TrustSHA)
		if fallbackErr != nil {
			return fmt.Errorf("health-checked Creator app could not be promoted (%v); no last-known-good app is available (%v)", err, fallbackErr)
		}
		return start(fallback)
	}
	return start(promoted)
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--launcher-version" {
		fmt.Printf("ORDAX_CREATOR_LAUNCHER_VERSION=%s\n", launcherVersion)
		return
	}
	resolution, err := resolveApp()
	if err != nil {
		showError(err)
		os.Exit(1)
	}
	if err := launch(resolution); err != nil {
		showError(err)
		os.Exit(1)
	}
}
