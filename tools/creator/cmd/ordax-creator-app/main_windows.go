//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	creatorupdate "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/update"
)

const (
	windowClassName = "OrdaXCreatorWindow"
	windowTitle     = "OrdaX Creator"

	wmDestroy = 0x0002
	wmCommand = 0x0111
	wmClose   = 0x0010
	wmApp     = 0x8000

	wmAppRefreshDone = wmApp + 1
	wmAppTrustDone   = wmApp + 2

	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsDisabled         = 0x08000000
	wsVScroll          = 0x00200000

	bsPushButton    = 0x00000000
	bsDefPushButton = 0x00000001
	cbsDropDownList = 0x0003

	cwUseDefault = 0x80000000
	swShow       = 5

	idDeviceCombo = 1001
	idRefresh     = 1002
	idWrite       = 1003
	idStatus      = 1004
	idVersion     = 1005
	idHint        = 1006
	idTrust       = 1007
	idOpenTrust   = 1008
	idTrustStatus = 1009
	idTrustHint   = 1010

	cbAddString    = 0x0143
	cbResetContent = 0x014B
	cbSetCurSel    = 0x014E
	bnClicked      = 0

	mbOKCancel        = 0x00000001
	mbIconInformation = 0x00000040
	idOK              = 1
	createNoWindow    = 0x08000000
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")

	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
	procUpdateWindow     = user32.NewProc("UpdateWindow")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procSendMessageW     = user32.NewProc("SendMessageW")
	procSetWindowTextW   = user32.NewProc("SetWindowTextW")
	procEnableWindow     = user32.NewProc("EnableWindow")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procGetStockObject   = gdi32.NewProc("GetStockObject")

	mainWindow    uintptr
	deviceCombo   uintptr
	refreshButton uintptr
	writeButton   uintptr
	statusLabel   uintptr
	versionLabel  uintptr
	hintLabel     uintptr
	trustButton   uintptr
	openTrust     uintptr
	trustStatus   uintptr
	trustHint     uintptr

	stateMu      sync.Mutex
	refreshState appRefreshState
)

type point struct {
	X int32
	Y int32
}

type msg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type physicalTargetsDocument struct {
	Schema  string           `json:"$schema"`
	Mode    string           `json:"mode"`
	Targets []physicalTarget `json:"targets"`
}

type physicalTarget struct {
	DriveLetter       string `json:"drive_letter"`
	VolumeLabel       string `json:"volume_label"`
	DiskNumber        int    `json:"disk_number"`
	PhysicalDiskBytes uint64 `json:"physical_disk_bytes"`
	DeviceSerial      string `json:"device_serial"`
	SystemDisk        bool   `json:"system_disk"`
	PrototypeSafe     bool   `json:"prototype_safe"`
	ConfirmationToken string `json:"confirmation_token"`
}

type trustStatusDocument struct {
	Schema                 string `json:"$schema"`
	Status                 string `json:"status"`
	Configured             bool   `json:"configured"`
	Valid                  bool   `json:"valid"`
	KeyID                  string `json:"key_id"`
	PublicTrustPath        string `json:"public_trust_path"`
	PublicTrustSHA256      string `json:"public_trust_sha256"`
	PrivateKeyProtected    bool   `json:"private_key_protected"`
	PrivateKeyProtection   string `json:"private_key_protection"`
	ProofVerified          bool   `json:"proof_verified"`
	OfflineBackupRequired  bool   `json:"offline_backup_required"`
	ReadyToPinPublicAnchor bool   `json:"ready_to_pin_public_anchor"`
}

type appRefreshState struct {
	Version          string
	SourceCommit     string
	Updated          bool
	Targets          []physicalTarget
	Error            string
	PhysicalReady    bool
	BackendDirectory string
	Trust            trustStatusDocument
	TrustError       string
}

func utf16Ptr(value string) *uint16 {
	ptr, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		panic(err)
	}
	return ptr
}

func loword(value uintptr) uint16 { return uint16(value & 0xffff) }
func hiword(value uintptr) uint16 { return uint16((value >> 16) & 0xffff) }

func setText(hwnd uintptr, text string) {
	procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(utf16Ptr(text))))
}

func enable(hwnd uintptr, enabled bool) {
	value := uintptr(0)
	if enabled {
		value = 1
	}
	procEnableWindow.Call(hwnd, value)
}

func send(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	result, _, _ := procSendMessageW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func createControl(class, text string, style uint32, x, y, width, height int32, id int) uintptr {
	hwnd, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(class))),
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		uintptr(style|wsChild|wsVisible),
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		mainWindow,
		uintptr(id),
		0,
		0,
	)
	if hwnd == 0 {
		panic(fmt.Sprintf("CreateWindowExW(%s): %v", class, err))
	}
	font, _, _ := procGetStockObject.Call(17)
	procSendMessageW.Call(hwnd, 0x0030, font, 1)
	return hwnd
}

func formatBytes(value uint64) string {
	const gib = uint64(1024 * 1024 * 1024)
	const mib = uint64(1024 * 1024)
	if value >= gib {
		return fmt.Sprintf("%.1f GB", float64(value)/float64(gib))
	}
	return fmt.Sprintf("%.0f MB", float64(value)/float64(mib))
}

func targetLabel(target physicalTarget) string {
	label := strings.TrimSpace(target.VolumeLabel)
	if label == "" {
		label = "Sem nome"
	}
	return fmt.Sprintf("%s  —  %s  —  Disco %d  —  %s", target.DriveLetter, label, target.DiskNumber, formatBytes(target.PhysicalDiskBytes))
}

func appendError(current, next string) string {
	if strings.TrimSpace(next) == "" {
		return current
	}
	if current == "" {
		return next
	}
	return current + "\n" + next
}

func runBackend(directory string, args ...string) ([]byte, error) {
	exe := filepath.Join(directory, "ordax-creator-physical-test.exe")
	command := exec.Command(exe, args...)
	command.Dir = directory
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", strings.Join(args, " "), err)
	}
	return output, nil
}

func loadTargets(directory string) ([]physicalTarget, bool, error) {
	output, err := runBackend(directory, "targets")
	if err != nil {
		return nil, false, fmt.Errorf("detectar pendrives: %w", err)
	}
	var document physicalTargetsDocument
	if err := json.Unmarshal(output, &document); err != nil {
		return nil, false, fmt.Errorf("ler lista de pendrives: %w", err)
	}
	if document.Schema != "prototype-ordax.creator-physical-test-targets/1" || document.Mode != "read-only" {
		return nil, false, fmt.Errorf("resposta de dispositivos inesperada")
	}
	for _, target := range document.Targets {
		if target.SystemDisk || !target.PrototypeSafe || len(target.ConfirmationToken) != 64 {
			return nil, false, fmt.Errorf("o backend retornou um alvo que não passou pela política de segurança")
		}
	}

	statusOutput, err := runBackend(directory, "status")
	if err != nil {
		return nil, false, fmt.Errorf("consultar estado físico: %w", err)
	}
	var status struct {
		Build struct {
			PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
			Ready                   bool `json:"ready"`
		} `json:"build"`
	}
	if err := json.Unmarshal(statusOutput, &status); err != nil {
		return nil, false, fmt.Errorf("ler estado físico: %w", err)
	}
	return document.Targets, status.Build.PhysicalWriteAuthorized && status.Build.Ready, nil
}

func loadTrust(directory string) (trustStatusDocument, error) {
	output, err := runBackend(directory, "trust-status")
	if err != nil {
		return trustStatusDocument{}, err
	}
	var status trustStatusDocument
	if err := json.Unmarshal(output, &status); err != nil {
		return trustStatusDocument{}, fmt.Errorf("ler estado de segurança: %w", err)
	}
	if status.Schema != "prototype-ordax.creator-trust-status/1" {
		return trustStatusDocument{}, fmt.Errorf("resposta de segurança inesperada")
	}
	if status.Configured && (!status.Valid || !status.PrivateKeyProtected || !status.ProofVerified) {
		return trustStatusDocument{}, fmt.Errorf("a identidade local existe, mas não passou pela validação criptográfica")
	}
	return status, nil
}

func initializeTrust(directory string) (trustStatusDocument, error) {
	output, err := runBackend(directory, "trust-init")
	if err != nil {
		return trustStatusDocument{}, err
	}
	var status trustStatusDocument
	if err := json.Unmarshal(output, &status); err != nil {
		return trustStatusDocument{}, fmt.Errorf("ler identidade criada: %w", err)
	}
	if status.Schema != "prototype-ordax.creator-trust-status/1" || !status.Configured || !status.Valid || !status.PrivateKeyProtected || !status.ProofVerified {
		return trustStatusDocument{}, fmt.Errorf("o backend não confirmou uma identidade local válida e protegida")
	}
	return status, nil
}

func refreshAsync() {
	go func() {
		result := appRefreshState{}
		installed, changed, err := creatorupdate.Ensure(nil, "", "")
		if err != nil {
			current, currentErr := creatorupdate.Current("")
			if currentErr != nil {
				result.Error = fmt.Sprintf("Não foi possível atualizar o Creator e nenhuma versão válida está instalada: %v", err)
			} else {
				installed = current
				result.Error = fmt.Sprintf("Sem atualização de rede; usando a última versão válida. %v", err)
			}
		}
		if installed.Version != "" {
			result.Version = installed.Version
			result.SourceCommit = installed.SourceCommit
			result.Updated = changed
			result.BackendDirectory = installed.Directory

			targets, ready, targetErr := loadTargets(installed.Directory)
			if targetErr != nil {
				result.Error = appendError(result.Error, targetErr.Error())
			} else {
				result.Targets = targets
				result.PhysicalReady = ready
			}

			trust, trustErr := loadTrust(installed.Directory)
			if trustErr != nil {
				result.TrustError = trustErr.Error()
			} else {
				result.Trust = trust
			}
		}
		stateMu.Lock()
		refreshState = result
		stateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppRefreshDone, 0, 0)
	}()
}

func renderTrust(state appRefreshState) {
	switch {
	case state.TrustError != "":
		setText(trustStatus, "Segurança de release: requer atenção")
		setText(trustHint, state.TrustError)
		setText(trustButton, "Configurar segurança")
		enable(trustButton, false)
		enable(openTrust, false)
	case !state.Trust.Configured:
		setText(trustStatus, "Segurança de release: ainda não configurada")
		setText(trustHint, "Cria uma identidade Ed25519 local. A chave privada fica criptografada pelo Windows e nunca é exibida ou enviada.")
		setText(trustButton, "Configurar segurança")
		enable(trustButton, state.BackendDirectory != "")
		enable(openTrust, false)
	case state.Trust.Valid && state.Trust.OfflineBackupRequired:
		setText(trustStatus, "Segurança de release: chave protegida — backup de recuperação pendente")
		setText(trustHint, "A identidade foi validada. A chave pública está pronta para revisão; a gravação física continua bloqueada até existir backup de recuperação verificado.")
		setText(trustButton, "Segurança configurada")
		enable(trustButton, false)
		enable(openTrust, state.Trust.PublicTrustPath != "")
	case state.Trust.Valid:
		setText(trustStatus, "Segurança de release: identidade local válida")
		setText(trustHint, "A identidade de release está protegida e validada.")
		setText(trustButton, "Segurança configurada")
		enable(trustButton, false)
		enable(openTrust, state.Trust.PublicTrustPath != "")
	default:
		setText(trustStatus, "Segurança de release: estado inválido")
		setText(trustHint, "A identidade local não passou pelas verificações de segurança.")
		enable(trustButton, false)
		enable(openTrust, false)
	}
}

func renderRefresh() {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()

	send(deviceCombo, cbResetContent, 0, 0)
	for _, target := range state.Targets {
		label := targetLabel(target)
		send(deviceCombo, cbAddString, 0, uintptr(unsafe.Pointer(utf16Ptr(label))))
	}
	if len(state.Targets) > 0 {
		send(deviceCombo, cbSetCurSel, 0, 0)
	}

	if state.Version != "" {
		version := "Componentes internos: " + state.Version
		if state.Updated {
			version += "  •  atualizados agora"
		}
		setText(versionLabel, version)
	}

	switch {
	case state.Error != "" && len(state.Targets) == 0:
		setText(statusLabel, "Não foi possível preparar o Creator.")
		setText(hintLabel, state.Error)
	case len(state.Targets) == 0:
		setText(statusLabel, "Nenhum pendrive USB elegível encontrado.")
		setText(hintLabel, "Conecte um pendrive USB e clique em Recarregar dispositivos.")
	case state.PhysicalReady:
		setText(statusLabel, fmt.Sprintf("%d pendrive(s) pronto(s) para uso.", len(state.Targets)))
		setText(hintLabel, "Confira o dispositivo selecionado antes de iniciar. O conteúdo do pendrive será apagado.")
	default:
		setText(statusLabel, fmt.Sprintf("%d pendrive(s) detectado(s). Modo seguro de desenvolvimento.", len(state.Targets)))
		if state.Error != "" {
			setText(hintLabel, state.Error)
		} else {
			setText(hintLabel, "A detecção está funcionando. Esta versão ainda não contém o backend autorizado de gravação física.")
		}
	}

	renderTrust(state)
	enable(refreshButton, true)
	enable(deviceCombo, len(state.Targets) > 0)
	canWrite := state.PhysicalReady && state.Trust.Valid && !state.Trust.OfflineBackupRequired
	enable(writeButton, canWrite)
}

func beginRefresh() {
	setText(statusLabel, "Verificando componentes e dispositivos USB…")
	setText(hintLabel, "Esta verificação não grava nem altera nenhum disco.")
	enable(refreshButton, false)
	enable(writeButton, false)
	enable(deviceCombo, false)
	enable(trustButton, false)
	enable(openTrust, false)
	refreshAsync()
}

func beginTrustSetup() {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()
	if state.BackendDirectory == "" || state.Trust.Configured {
		return
	}

	message := "O OrdaX Creator criará uma identidade Ed25519 para assinar releases oficiais.\n\n" +
		"A chave privada será criptografada pelo Windows (DPAPI) no seu perfil e nunca será exibida ou enviada. " +
		"Somente a chave pública poderá ser compartilhada.\n\n" +
		"Isso não grava nem altera o pendrive.\n\nContinuar?"
	result, _, _ := procMessageBoxW.Call(
		mainWindow,
		uintptr(unsafe.Pointer(utf16Ptr(message))),
		uintptr(unsafe.Pointer(utf16Ptr("Configurar segurança do OrdaX"))),
		mbOKCancel|mbIconInformation,
	)
	if result != idOK {
		return
	}

	setText(trustStatus, "Segurança de release: criando identidade protegida…")
	setText(trustHint, "Gerando a chave local e validando a prova criptográfica.")
	enable(trustButton, false)
	enable(openTrust, false)
	enable(writeButton, false)

	go func(directory string) {
		status, err := initializeTrust(directory)
		stateMu.Lock()
		if err != nil {
			refreshState.TrustError = err.Error()
		} else {
			refreshState.Trust = status
			refreshState.TrustError = ""
		}
		stateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppTrustDone, 0, 0)
	}(state.BackendDirectory)
}

func openPublicTrust() {
	stateMu.Lock()
	path := refreshState.Trust.PublicTrustPath
	stateMu.Unlock()
	if path == "" {
		return
	}
	command := exec.Command("explorer.exe", "/select,"+path)
	_ = command.Start()
}

func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case wmCommand:
		id := int(loword(wParam))
		notify := hiword(wParam)
		if notify != bnClicked {
			break
		}
		switch id {
		case idRefresh:
			beginRefresh()
			return 0
		case idTrust:
			beginTrustSetup()
			return 0
		case idOpenTrust:
			openPublicTrust()
			return 0
		case idWrite:
			return 0
		}
	case wmAppRefreshDone, wmAppTrustDone:
		renderRefresh()
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func createMainWindow() {
	instance, _, _ := procGetModuleHandleW.Call(0)
	className := utf16Ptr(windowClassName)
	class := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:    syscall.NewCallback(wndProc),
		Instance:   instance,
		Background: 6,
		ClassName:  className,
	}
	atom, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
	if atom == 0 {
		panic(fmt.Sprintf("RegisterClassExW: %v", err))
	}

	hwnd, _, err := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr(windowTitle))),
		wsOverlappedWindow,
		cwUseDefault, cwUseDefault,
		780, 590,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		panic(fmt.Sprintf("CreateWindowExW(main): %v", err))
	}
	mainWindow = hwnd

	createControl("STATIC", "OrdaX Creator", 0, 28, 22, 700, 28, 0)
	createControl("STATIC", "Prepare seu pendrive OrdaX com atualização e segurança integradas.", 0, 28, 54, 700, 22, 0)

	createControl("STATIC", "Dispositivo USB", 0, 28, 100, 700, 20, 0)
	deviceCombo = createControl("COMBOBOX", "", wsTabStop|wsVScroll|cbsDropDownList|wsDisabled, 28, 126, 700, 220, idDeviceCombo)
	statusLabel = createControl("STATIC", "Inicializando…", 0, 28, 176, 700, 22, idStatus)
	hintLabel = createControl("STATIC", "", 0, 28, 204, 700, 44, idHint)

	createControl("STATIC", "Segurança das releases", 0, 28, 268, 700, 20, 0)
	trustStatus = createControl("STATIC", "Segurança de release: verificando…", 0, 28, 294, 700, 22, idTrustStatus)
	trustHint = createControl("STATIC", "", 0, 28, 322, 700, 44, idTrustHint)
	trustButton = createControl("BUTTON", "Configurar segurança", wsTabStop|bsPushButton|wsDisabled, 28, 376, 210, 36, idTrust)
	openTrust = createControl("BUTTON", "Abrir chave pública", wsTabStop|bsPushButton|wsDisabled, 252, 376, 190, 36, idOpenTrust)

	versionLabel = createControl("STATIC", "Componentes internos: verificando…", 0, 28, 438, 700, 20, idVersion)
	refreshButton = createControl("BUTTON", "Recarregar dispositivos", wsTabStop|bsPushButton, 28, 486, 210, 38, idRefresh)
	writeButton = createControl("BUTTON", "Criar pendrive OrdaX", wsTabStop|bsDefPushButton|wsDisabled, 508, 486, 220, 38, idWrite)

	procShowWindow.Call(mainWindow, swShow)
	procUpdateWindow.Call(mainWindow)
	beginRefresh()
}

func messageLoop() int {
	var message msg
	for {
		result, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) == -1 {
			return 1
		}
		if result == 0 {
			return 0
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message)))
	}
}

func main() {
	runtime.LockOSThread()
	createMainWindow()
	if code := messageLoop(); code != 0 {
		panic("Windows message loop failed")
	}
}
