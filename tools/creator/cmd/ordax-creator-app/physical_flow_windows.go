//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	mbOK              = 0x00000000
	mbYesNo           = 0x00000004
	mbIconError       = 0x00000010
	mbIconWarning     = 0x00000030
	mbIconInformation = 0x00000040
	mbDefButton2      = 0x00000100
	idYes             = 6

	seeMaskNoCloseProcess = 0x00000040
	swHide                 = 0
	infinite               = 0xffffffff
	waitObject0            = 0x00000000
)

var (
	shell32 = syscall.NewLazyDLL("shell32.dll")

	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procShellExecuteExW     = shell32.NewProc("ShellExecuteExW")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess  = kernel32.NewProc("GetExitCodeProcess")
	procCloseHandle         = kernel32.NewProc("CloseHandle")

	writeMu    sync.Mutex
	writeState physicalWriteState
)

type shellExecuteInfo struct {
	Size       uint32
	Mask       uint32
	HWND       uintptr
	Verb       *uint16
	File       *uint16
	Parameters *uint16
	Directory  *uint16
	Show       int32
	Instance   uintptr
	IDList     uintptr
	Class      *uint16
	KeyClass   uintptr
	HotKey     uint32
	Icon       uintptr
	Process    uintptr
}

type preparedPhysicalImage struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
}

type physicalPreparationDocument struct {
	Schema                   string                `json:"$schema"`
	Target                   physicalTarget        `json:"target"`
	PreparedImage            preparedPhysicalImage `json:"prepared_image"`
	DestructiveAuthorization string                `json:"destructive_authorization"`
}

type physicalWriteState struct {
	Active  bool
	Status  string
	Hint    string
	Success bool
	Error   string
}

func messageBox(text, title string, flags uint32) int {
	result, _, _ := procMessageBoxW.Call(
		mainWindow,
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		uintptr(unsafe.Pointer(utf16Ptr(title))),
		uintptr(flags),
	)
	return int(result)
}

func writeInProgress() bool {
	writeMu.Lock()
	defer writeMu.Unlock()
	return writeState.Active
}

func updateWriteProgress(status, hint string) {
	writeMu.Lock()
	writeState.Active = true
	writeState.Status = status
	writeState.Hint = hint
	writeState.Success = false
	writeState.Error = ""
	writeMu.Unlock()
	procPostMessageW.Call(mainWindow, wmAppWriteProgress, 0, 0)
}

func completeWrite(err error) {
	writeMu.Lock()
	writeState.Active = false
	if err != nil {
		writeState.Success = false
		writeState.Error = err.Error()
		writeState.Status = "Não foi possível criar o pendrive OrdaX."
		writeState.Hint = "Nenhuma conclusão foi assumida. Confira o erro e recarregue os dispositivos antes de tentar novamente."
	} else {
		writeState.Success = true
		writeState.Error = ""
		writeState.Status = "Pendrive OrdaX criado e verificado."
		writeState.Hint = "Gravação, verificação por leitura e ORDAX-DATA foram concluídos. O espaço de arquivos está pronto no Windows; remova o USB com segurança e teste o boot no notebook."
	}
	writeMu.Unlock()
	procPostMessageW.Call(mainWindow, wmAppWriteDone, 0, 0)
}

func renderWriteProgress() {
	writeMu.Lock()
	state := writeState
	writeMu.Unlock()
	setText(statusLabel, state.Status)
	setText(hintLabel, state.Hint)
	setProgressActive()
	enable(refreshButton, false)
	enable(updateButton, false)
	enable(writeButton, false)
	enable(deviceCombo, false)
}

func renderWriteDone() {
	writeMu.Lock()
	state := writeState
	writeMu.Unlock()

	setText(statusLabel, state.Status)
	setText(hintLabel, state.Hint)
	if state.Success {
		setProgressComplete()
		messageBox(
			"O pendrive OrdaX foi criado, passou pela verificação de leitura e o espaço ORDAX-DATA foi preparado em exFAT.\n\nO volume de arquivos deve aparecer normalmente no Windows. Agora o USB está pronto para o teste de boot no notebook.",
			"OrdaX Creator",
			mbOK|mbIconInformation,
		)
	} else {
		setProgressIdle()
		if state.Error != "" {
			messageBox(
				"A criação do pendrive não foi concluída.\n\n"+state.Error,
				"OrdaX Creator",
				mbOK|mbIconError,
			)
		}
	}

	stateMu.Lock()
	current := refreshState
	stateMu.Unlock()
	enable(refreshButton, true)
	enable(deviceCombo, len(current.Targets) > 0)
	enable(writeButton, current.PhysicalReady && len(current.Targets) > 0)
	renderUpdateUI()
}

func showWriteBusyMessage() {
	messageBox(
		"A criação do pendrive está em andamento.\n\nNão feche o Creator nem remova o USB até a operação terminar.",
		"OrdaX Creator",
		mbOK|mbIconInformation,
	)
}

func selectedPhysicalTarget() (physicalTarget, appRefreshState, error) {
	stateMu.Lock()
	state := refreshState
	stateMu.Unlock()
	if !state.PhysicalReady || state.BackendDirectory == "" {
		return physicalTarget{}, state, fmt.Errorf("a versão física do Creator ainda não está pronta para gravação")
	}
	index := int32(send(deviceCombo, cbGetCurSel, 0, 0))
	if index < 0 || int(index) >= len(state.Targets) {
		return physicalTarget{}, state, fmt.Errorf("selecione um pendrive USB válido")
	}
	target := state.Targets[index]
	if target.SystemDisk || !target.PrototypeSafe || len(target.ConfirmationToken) != 64 {
		return physicalTarget{}, state, fmt.Errorf("o dispositivo selecionado não passou pela política de segurança")
	}
	return target, state, nil
}

func beginPhysicalWrite() {
	if writeInProgress() {
		return
	}
	target, state, err := selectedPhysicalTarget()
	if err != nil {
		messageBox(err.Error(), "OrdaX Creator", mbOK|mbIconError)
		return
	}

	label := strings.TrimSpace(target.VolumeLabel)
	if label == "" {
		label = "Sem nome"
	}
	warning := fmt.Sprintf(
		"Todos os dados deste pendrive serão apagados.\n\nDispositivo: %s\nNome: %s\nDisco: %d\nTamanho: %s\nSerial: %s\n\nDeseja criar o pendrive OrdaX?",
		target.DriveLetter,
		label,
		target.DiskNumber,
		formatBytes(target.PhysicalDiskBytes),
		target.DeviceSerial,
	)
	if messageBox(warning, "Confirmar criação do pendrive", mbYesNo|mbIconWarning|mbDefButton2) != idYes {
		return
	}

	updateWriteProgress("Preparando o pendrive OrdaX…", "A imagem oficial está sendo validada e preparada para o tamanho exato do USB selecionado.")
	go func() {
		completeWrite(executePhysicalWrite(state.BackendDirectory, target))
	}()
}

func executePhysicalWrite(directory string, target physicalTarget) error {
	backend := filepath.Join(directory, "ordax-creator-physical-test.exe")
	seed := filepath.Join(directory, "ordax-bootstrap-seed.raw")
	for _, path := range []string{backend, seed} {
		info, err := os.Lstat(path)
		if err != nil {
			return fmt.Errorf("pacote físico incompleto: %s não está disponível", filepath.Base(path))
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("pacote físico inválido: %s não é um arquivo regular", filepath.Base(path))
		}
	}

	workRoot := filepath.Join(os.TempDir(), "OrdaX-Creator")
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return fmt.Errorf("preparar área temporária: %w", err)
	}
	workDir, err := os.MkdirTemp(workRoot, "physical-write-*")
	if err != nil {
		return fmt.Errorf("criar área temporária: %w", err)
	}
	defer os.RemoveAll(workDir)
	preparedPath := filepath.Join(workDir, "ordax-prepared.raw")

	updateWriteProgress("Preparando imagem para o USB…", "O Creator está conferindo a imagem do OrdaX e ajustando o layout GPT ao tamanho do pendrive, preservando o restante para ORDAX-DATA.")
	output, err := runBackendHidden(
		directory,
		"prepare",
		"--confirm", target.ConfirmationToken,
		"--seed", seed,
		"--out", preparedPath,
	)
	if err != nil {
		return fmt.Errorf("preparar imagem física: %w", err)
	}
	var preparation physicalPreparationDocument
	if err := json.Unmarshal(output, &preparation); err != nil {
		return fmt.Errorf("ler resultado da preparação: %w", err)
	}
	if err := validatePhysicalPreparation(preparation, target, preparedPath); err != nil {
		return err
	}

	updateWriteProgress("Aguardando autorização do Windows…", "Confirme a janela de Controle de Conta de Usuário. Depois disso o Creator gravará, verificará e preparará automaticamente o espaço ORDAX-DATA.")
	args := []string{
		"apply",
		"--confirm", target.ConfirmationToken,
		"--image", preparation.PreparedImage.Path,
		"--sha256", preparation.PreparedImage.SHA256,
		"--size", strconv.FormatInt(preparation.PreparedImage.SizeBytes, 10),
		"--authorize", preparation.DestructiveAuthorization,
	}
	if err := runElevatedAndWait(backend, directory, args); err != nil {
		return err
	}

	updateWriteProgress("Concluindo…", "Gravação, verificação por leitura e ORDAX-DATA foram confirmados. Finalizando o Creator.")
	return nil
}

func validatePhysicalPreparation(preparation physicalPreparationDocument, target physicalTarget, preparedPath string) error {
	if preparation.Schema != "prototype-ordax.creator-physical-test-preparation/2" {
		return fmt.Errorf("o backend retornou uma preparação incompatível")
	}
	if preparation.Target.DiskNumber != target.DiskNumber ||
		preparation.Target.ConfirmationToken != target.ConfirmationToken ||
		preparation.Target.SystemDisk || !preparation.Target.PrototypeSafe {
		return fmt.Errorf("o dispositivo mudou durante a preparação; operação cancelada")
	}
	if preparation.PreparedImage.Path != preparedPath ||
		preparation.PreparedImage.SizeBytes != int64(target.PhysicalDiskBytes) ||
		len(preparation.PreparedImage.SHA256) != 64 ||
		len(preparation.DestructiveAuthorization) != 64 {
		return fmt.Errorf("a preparação física não produziu os vínculos esperados")
	}
	return nil
}

func runElevatedAndWait(executable, directory string, args []string) error {
	parameters := make([]string, 0, len(args))
	for _, arg := range args {
		parameters = append(parameters, syscall.EscapeArg(arg))
	}
	info := shellExecuteInfo{
		Size:       uint32(unsafe.Sizeof(shellExecuteInfo{})),
		Mask:       seeMaskNoCloseProcess,
		HWND:       mainWindow,
		Verb:       utf16Ptr("runas"),
		File:       utf16Ptr(executable),
		Parameters: utf16Ptr(strings.Join(parameters, " ")),
		Directory:  utf16Ptr(directory),
		Show:       swHide,
	}
	ok, _, callErr := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == 1223 {
			return fmt.Errorf("a autorização do Windows foi cancelada")
		}
		return fmt.Errorf("não foi possível solicitar autorização administrativa: %v", callErr)
	}
	if info.Process == 0 {
		return fmt.Errorf("o Windows não retornou o processo elevado")
	}
	defer procCloseHandle.Call(info.Process)

	// ShellExecuteEx returns only after the elevated child was actually created.
	// At this point UAC was accepted, so keeping the UI at “waiting for
	// authorization” is wrong and makes a healthy raw write look frozen.
	updateWriteProgress(
		"Gravando, verificando e preparando arquivos…",
		"Autorização do Windows confirmada. Não remova o USB; o Creator está gravando, fará a leitura de verificação e preparará o volume ORDAX-DATA antes de concluir.",
	)

	wait, _, waitErr := procWaitForSingleObject.Call(info.Process, infinite)
	if wait != waitObject0 {
		return fmt.Errorf("falha aguardando a gravação elevada: %v", waitErr)
	}
	var exitCode uint32
	ok, _, exitErr := procGetExitCodeProcess.Call(info.Process, uintptr(unsafe.Pointer(&exitCode)))
	if ok == 0 {
		return fmt.Errorf("não foi possível ler o resultado da gravação: %v", exitErr)
	}
	if exitCode != 0 {
		return fmt.Errorf("a gravação física foi interrompida ou falhou (código %d)", exitCode)
	}
	return nil
}
