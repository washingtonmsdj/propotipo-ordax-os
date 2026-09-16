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
)

const (
	windowClassName = "OrdaXCreatorWindow"
	windowTitle     = "OrdaX Creator"

	wmDestroy = 0x0002
	wmCommand = 0x0111
	wmClose   = 0x0010
	wmApp     = 0x8000

	wmAppRefreshDone   = wmApp + 1
	wmAppWriteProgress = wmApp + 2
	wmAppWriteDone     = wmApp + 3
	wmAppUpdateDone    = wmApp + 4

	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsDisabled         = 0x08000000
	wsVScroll          = 0x00200000

	bsPushButton    = 0x00000000
	bsDefPushButton = 0x00000001
	cbsDropDownList = 0x0003
	pbsMarquee      = 0x00000008

	iccProgressClass = 0x00000020
	pbmSetPos        = 0x0402
	pbmSetMarquee    = 0x040A

	cwUseDefault = 0x80000000
	swShow       = 5

	idDeviceCombo = 1001
	idRefresh     = 1002
	idWrite       = 1003
	idStatus      = 1004
	idVersion     = 1005
	idHint        = 1006
	idUpdate      = 1007
	idProgress    = 1008

	cbAddString    = 0x0143
	cbResetContent = 0x014B
	cbSetCurSel    = 0x014E
	cbGetCurSel    = 0x0147
	cbnSelChange   = 1
	bnClicked      = 0

	createNoWindow = 0x08000000
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	comctl32 = syscall.NewLazyDLL("comctl32.dll")

	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procEnableWindow         = user32.NewProc("EnableWindow")
	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	procGetStockObject       = gdi32.NewProc("GetStockObject")
	procInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")

	mainWindow    uintptr
	deviceCombo   uintptr
	refreshButton uintptr
	updateButton  uintptr
	writeButton   uintptr
	statusLabel   uintptr
	versionLabel  uintptr
	hintLabel     uintptr
	progressBar   uintptr

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

type initCommonControlsEx struct {
	Size uint32
	ICC  uint32
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

type appRefreshState struct {
	Version          string
	SourceCommit     string
	Updated          bool
	Targets          []physicalTarget
	Error            string
	PhysicalReady    bool
	BackendDirectory string
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

func setProgressIdle() {
	if progressBar == 0 {
		return
	}
	send(progressBar, pbmSetMarquee, 0, 0)
	send(progressBar, pbmSetPos, 0, 0)
}

func setProgressActive() {
	if progressBar == 0 {
		return
	}
	send(progressBar, pbmSetMarquee, 1, 35)
}

func setProgressComplete() {
	if progressBar == 0 {
		return
	}
	send(progressBar, pbmSetMarquee, 0, 0)
	send(progressBar, pbmSetPos, 100, 0)
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
	return fmt.Sprintf("%s  —  %s  —  %s", target.DriveLetter, label, formatBytes(target.PhysicalDiskBytes))
}

func runBackendHidden(directory string, args ...string) ([]byte, error) {
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
	output, err := runBackendHidden(directory, "targets")
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

	statusOutput, err := runBackendHidden(directory, "status")
	if err != nil {
		return nil, false, fmt.Errorf("consultar estado físico: %w", err)
	}
	var status struct {
		RawBackendLinked bool `json:"raw_backend_linked"`
		Build struct {
			PhysicalWriteAuthorized bool `json:"physical_write_authorized"`
			Ready                   bool `json:"ready"`
		} `json:"build"`
	}
	if err := json.Unmarshal(statusOutput, &status); err != nil {
		return nil, false, fmt.Errorf("ler estado físico: %w", err)
	}
	return document.Targets, status.RawBackendLinked && status.Build.PhysicalWriteAuthorized && status.Build.Ready, nil
}

func refreshAsync() {
	go func() {
		result := resolveRefreshState()
		stateMu.Lock()
		refreshState = result
		stateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppRefreshDone, 0, 0)
	}()
}

func selectedTargetIndex() int {
	index := int32(send(deviceCombo, cbGetCurSel, 0, 0))
	if index < 0 {
		return -1
	}
	return int(index)
}

func updateSelectionUI() {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()

	busy := writeInProgress()
	index := selectedTargetIndex()
	selected := index >= 0 && index < len(state.Targets)
	enable(writeButton, !busy && state.PhysicalReady && selected)

	if busy || len(state.Targets) == 0 {
		return
	}
	if !selected {
		setText(statusLabel, "Escolha o pendrive que receberá o OrdaX.")
		setText(hintLabel, "Só o USB selecionado será apagado. Nenhuma ISO ou configuração é necessária.")
		return
	}
	if state.PhysicalReady {
		setText(statusLabel, "Pendrive selecionado. Pronto para criar o OrdaX.")
		setText(hintLabel, "Clique em Criar OrdaX. O Creator prepara, grava e verifica automaticamente.")
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
	if len(state.Targets) == 1 {
		send(deviceCombo, cbSetCurSel, 0, 0)
	}

	if state.Version != "" {
		version := "OrdaX Creator • " + state.Version
		if state.Updated {
			version += " • atualizado"
		}
		setText(versionLabel, version)
	}

	switch {
	case state.Error != "" && len(state.Targets) == 0:
		setText(statusLabel, "Não foi possível preparar o Creator.")
		setText(hintLabel, state.Error)
	case len(state.Targets) == 0:
		setText(statusLabel, "Conecte um pendrive USB.")
		setText(hintLabel, "O Creator detecta pendrives automaticamente. Se acabou de conectar um, clique em Recarregar USB.")
	case !state.PhysicalReady:
		setText(statusLabel, fmt.Sprintf("%d pendrive(s) encontrado(s).", len(state.Targets)))
		setText(hintLabel, "A criação não está habilitada neste canal do Creator.")
	default:
		setText(statusLabel, "Escolha o pendrive que receberá o OrdaX.")
		setText(hintLabel, "Você não precisa escolher ISO, imagem, versão ou configuração técnica.")
	}

	if !writeInProgress() {
		setProgressIdle()
	}
	busy := writeInProgress()
	enable(refreshButton, !busy)
	enable(deviceCombo, !busy && len(state.Targets) > 0)
	updateSelectionUI()
	renderUpdateUI()
}

func beginRefresh() {
	if writeInProgress() {
		return
	}
	setText(statusLabel, "Procurando pendrives…")
	setText(hintLabel, "Atualizando a lista de dispositivos USB disponíveis.")
	enable(refreshButton, false)
	enable(writeButton, false)
	enable(deviceCombo, false)
	refreshAsync()
}

func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case wmCommand:
		id := int(loword(wParam))
		notify := hiword(wParam)
		if id == idDeviceCombo && notify == cbnSelChange {
			updateSelectionUI()
			return 0
		}
		if id == idRefresh && notify == bnClicked {
			beginRefresh()
			return 0
		}
		if id == idUpdate && notify == bnClicked {
			handleUpdateButton()
			return 0
		}
		if id == idWrite && notify == bnClicked {
			beginPhysicalWrite()
			return 0
		}
	case wmAppRefreshDone:
		renderRefresh()
		return 0
	case wmAppWriteProgress:
		renderWriteProgress()
		return 0
	case wmAppWriteDone:
		renderWriteDone()
		return 0
	case wmAppUpdateDone:
		renderUpdateDone()
		return 0
	case wmClose:
		if writeInProgress() {
			showWriteBusyMessage()
			return 0
		}
		procPostQuitMessage.Call(0)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func createMainWindow() {
	controls := initCommonControlsEx{Size: uint32(unsafe.Sizeof(initCommonControlsEx{})), ICC: iccProgressClass}
	procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&controls)))

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
		700, 390,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		panic(fmt.Sprintf("CreateWindowExW(main): %v", err))
	}
	mainWindow = hwnd

	createControl("STATIC", "Criar pendrive OrdaX", 0, 28, 24, 630, 28, 0)
	createControl("STATIC", "Conecte o USB, escolha o pendrive e pronto. O restante é automático.", 0, 28, 56, 630, 22, 0)
	createControl("STATIC", "Pendrive", 0, 28, 96, 630, 20, 0)
	deviceCombo = createControl("COMBOBOX", "", wsTabStop|wsVScroll|cbsDropDownList|wsDisabled, 28, 122, 630, 220, idDeviceCombo)
	statusLabel = createControl("STATIC", "Procurando pendrives…", 0, 28, 172, 630, 22, idStatus)
	hintLabel = createControl("STATIC", "", 0, 28, 202, 630, 42, idHint)
	progressBar = createControl("msctls_progress32", "", pbsMarquee, 28, 250, 630, 14, idProgress)
	versionLabel = createControl("STATIC", "OrdaX Creator • verificando versão…", 0, 28, 292, 245, 20, idVersion)
	updateButton = createControl("BUTTON", "Atualizações", wsTabStop|bsPushButton, 280, 280, 118, 36, idUpdate)
	refreshButton = createControl("BUTTON", "Recarregar USB", wsTabStop|bsPushButton, 406, 280, 118, 36, idRefresh)
	writeButton = createControl("BUTTON", "Criar OrdaX", wsTabStop|bsDefPushButton|wsDisabled, 532, 280, 126, 36, idWrite)
	setProgressIdle()

	procShowWindow.Call(mainWindow, swShow)
	procUpdateWindow.Call(mainWindow)
	markOwnerUpdateHealthy()
	beginRefresh()
	beginUpdateCheck(false)
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
