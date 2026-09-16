//go:build windows

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	ownerUpdateManifestURL       = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-owner-prototype/creator-owner-update.json"
	ownerSelfUpdateHelperCommand = "--ordax-self-update-helper"
	ownerUpdateHealthCommand     = "--ordax-update-health"
	ownerSelfUpdateTicketSchema  = "prototype-ordax.creator-self-update/1"
	processSynchronize           = 0x00100000
	invalidParameterErrno        = syscall.Errno(87)
)

var (
	procOpenProcess = kernel32.NewProc("OpenProcess")

	updateMu           sync.Mutex
	currentUpdateState updateUIState
	updateHealthMarker string
)

type ownerUpdateManifest struct {
	Schema       string `json:"$schema"`
	Channel      string `json:"channel"`
	Version      string `json:"version"`
	SourceCommit string `json:"source_commit"`
	DownloadURL  string `json:"download_url"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
}

type updateUIState struct {
	Checking     bool
	Installing   bool
	RestartReady bool
	Manual       bool
	Available    bool
	Version      string
	SourceCommit string
	DownloadURL  string
	SHA256       string
	Size         int64
	Error        string
}

type ownerSelfUpdateTicket struct {
	Schema        string `json:"$schema"`
	ParentPID     int    `json:"parent_pid"`
	TargetPath    string `json:"target_path"`
	CurrentSHA256 string `json:"current_sha256"`
	NewSHA256     string `json:"new_sha256"`
	NewSize       int64  `json:"new_size"`
	SourceCommit  string `json:"source_commit"`
}

func validLowerHexString(value string, size int) bool {
	if len(value) != size || value != strings.ToLower(value) {
		return false
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}

func validateOwnerUpdateManifest(manifest ownerUpdateManifest) error {
	if manifest.Schema != "prototype-ordax.creator-owner-update/2" {
		return errors.New("manifesto de atualização incompatível")
	}
	if manifest.Channel != "owner-prototype" {
		return errors.New("canal de atualização inesperado")
	}
	if !validLowerHexString(manifest.SourceCommit, 40) {
		return errors.New("source_commit inválido")
	}
	if manifest.Version != "owner-"+manifest.SourceCommit[:12] {
		return errors.New("versão não corresponde ao commit publicado")
	}
	if !validLowerHexString(manifest.SHA256, 64) || manifest.Size <= 0 || manifest.Size > 256<<20 {
		return errors.New("vínculo do executável de atualização inválido")
	}
	parsed, err := url.Parse(manifest.DownloadURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("URL de atualização inválida")
	}
	if parsed.Path != "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-owner-prototype/OrdaX-Creator.exe" {
		return errors.New("executável de atualização fora do canal OrdaX")
	}
	return nil
}

func fetchOwnerUpdateManifest() (ownerUpdateManifest, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, ownerUpdateManifestURL+"?ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), nil)
	if err != nil {
		return ownerUpdateManifest{}, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Owner-Updater/3")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return ownerUpdateManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ownerUpdateManifest{}, fmt.Errorf("servidor de atualização respondeu HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10+1))
	if err != nil {
		return ownerUpdateManifest{}, err
	}
	if len(data) == 0 || len(data) > 64<<10 {
		return ownerUpdateManifest{}, errors.New("manifesto de atualização com tamanho inválido")
	}
	var manifest ownerUpdateManifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return ownerUpdateManifest{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ownerUpdateManifest{}, errors.New("manifesto de atualização contém dados extras")
	}
	if err := validateOwnerUpdateManifest(manifest); err != nil {
		return ownerUpdateManifest{}, err
	}
	return manifest, nil
}

func ownerUpdateIsForward(currentSource, candidateSource string) (bool, error) {
	if currentSource == candidateSource {
		return false, nil
	}
	if !validLowerHexString(currentSource, 40) || !validLowerHexString(candidateSource, 40) {
		return false, errors.New("não foi possível validar a ordem das versões")
	}
	compareURL := "https://api.github.com/repos/washingtonmsdj/prototipo-ordax-os/compare/" + currentSource + "..." + candidateSource + "?per_page=1"
	client := &http.Client{Timeout: 20 * time.Second}
	req, err := http.NewRequest(http.MethodGet, compareURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Owner-Updater/3")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("não foi possível validar anti-downgrade (HTTP %d)", resp.StatusCode)
	}
	var comparison struct {
		Status   string `json:"status"`
		AheadBy  int    `json:"ahead_by"`
		BehindBy int    `json:"behind_by"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 16<<20))
	if err := decoder.Decode(&comparison); err != nil {
		return false, fmt.Errorf("ler validação anti-downgrade: %w", err)
	}
	if comparison.Status == "ahead" && comparison.AheadBy > 0 && comparison.BehindBy == 0 {
		return true, nil
	}
	return false, fmt.Errorf("a versão publicada não é descendente da versão atual; atualização bloqueada (status=%s)", comparison.Status)
}

func ownerUpdateRoot() (string, error) {
	root, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(root) == "" {
		return "", errors.New("não foi possível localizar a área privada de atualizações do usuário")
	}
	root = filepath.Join(root, "OrdaX", "Creator", "updates")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("criar área de atualizações: %w", err)
	}
	return filepath.Clean(root), nil
}

func pathInside(root, path string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	pathAbs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil || relative == "." || relative == ".." {
		return false
	}
	return !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func hashUpdateRegularFile(path string) (string, int64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", 0, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", 0, errors.New("arquivo de atualização deve ser regular e não pode ser link")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	digest := sha256.New()
	read, err := io.Copy(digest, file)
	if err != nil {
		return "", 0, err
	}
	if read != info.Size() {
		return "", 0, errors.New("leitura incompleta durante validação SHA-256")
	}
	return hex.EncodeToString(digest.Sum(nil)), read, nil
}

func downloadOwnerUpdate(manifest ownerUpdateManifest) (string, error) {
	root, err := ownerUpdateRoot()
	if err != nil {
		return "", err
	}
	directory := filepath.Join(root, manifest.SourceCommit)
	if err := os.RemoveAll(directory); err != nil {
		return "", fmt.Errorf("limpar atualização anterior: %w", err)
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("criar diretório da atualização: %w", err)
	}
	stagedPath := filepath.Join(directory, "OrdaX-Creator.exe")

	client := &http.Client{Timeout: 2 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, manifest.DownloadURL+"?ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Owner-Updater/3")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("baixar atualização: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download da atualização respondeu HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength >= 0 && resp.ContentLength != manifest.Size {
		return "", fmt.Errorf("tamanho HTTP inesperado: esperado=%d atual=%d", manifest.Size, resp.ContentLength)
	}

	file, err := os.OpenFile(stagedPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700)
	if err != nil {
		return "", err
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(stagedPath)
		}
	}()
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest), io.LimitReader(resp.Body, manifest.Size+1))
	if err != nil {
		return "", fmt.Errorf("salvar atualização: %w", err)
	}
	if written != manifest.Size {
		return "", fmt.Errorf("tamanho baixado inválido: esperado=%d atual=%d", manifest.Size, written)
	}
	actualSHA := hex.EncodeToString(digest.Sum(nil))
	if actualSHA != manifest.SHA256 {
		return "", errors.New("SHA-256 da atualização não corresponde ao manifesto publicado")
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	cleanup = false
	return stagedPath, nil
}

func writeOwnerSelfUpdateTicket(manifest ownerUpdateManifest, stagedPath string) (string, error) {
	target, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("localizar Creator atual: %w", err)
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return "", err
	}
	root, err := ownerUpdateRoot()
	if err != nil {
		return "", err
	}
	if pathInside(root, target) {
		return "", errors.New("o Creator atual está dentro da área temporária de atualização; mova-o para uma pasta normal antes de atualizar")
	}
	currentSHA, _, err := hashUpdateRegularFile(target)
	if err != nil {
		return "", fmt.Errorf("validar Creator atual: %w", err)
	}
	stagedSHA, stagedSize, err := hashUpdateRegularFile(stagedPath)
	if err != nil {
		return "", fmt.Errorf("validar Creator baixado: %w", err)
	}
	if stagedSHA != manifest.SHA256 || stagedSize != manifest.Size {
		return "", errors.New("o executável preparado perdeu o vínculo com o manifesto")
	}
	ticket := ownerSelfUpdateTicket{
		Schema:        ownerSelfUpdateTicketSchema,
		ParentPID:     os.Getpid(),
		TargetPath:    target,
		CurrentSHA256: currentSHA,
		NewSHA256:     manifest.SHA256,
		NewSize:       manifest.Size,
		SourceCommit:  manifest.SourceCommit,
	}
	data, err := json.Marshal(ticket)
	if err != nil {
		return "", err
	}
	data = append(data, '\n')
	ticketPath := filepath.Join(filepath.Dir(stagedPath), "update-ticket.json")
	if err := os.WriteFile(ticketPath, data, 0o600); err != nil {
		return "", fmt.Errorf("criar autorização local da atualização: %w", err)
	}
	return ticketPath, nil
}

func stageAndLaunchOwnerSelfUpdate(state updateUIState) error {
	manifest := ownerUpdateManifest{
		Schema:       "prototype-ordax.creator-owner-update/2",
		Channel:      "owner-prototype",
		Version:      state.Version,
		SourceCommit: state.SourceCommit,
		DownloadURL:  state.DownloadURL,
		SHA256:       state.SHA256,
		Size:         state.Size,
	}
	if err := validateOwnerUpdateManifest(manifest); err != nil {
		return err
	}
	stagedPath, err := downloadOwnerUpdate(manifest)
	if err != nil {
		return err
	}
	ticketPath, err := writeOwnerSelfUpdateTicket(manifest, stagedPath)
	if err != nil {
		return err
	}
	command := exec.Command(stagedPath, ownerSelfUpdateHelperCommand, "--ticket", ticketPath)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := command.Start(); err != nil {
		return fmt.Errorf("iniciar troca segura da atualização: %w", err)
	}
	if err := command.Process.Release(); err != nil {
		return fmt.Errorf("liberar helper de atualização: %w", err)
	}
	return nil
}

func waitForUpdateParent(parentPID int, timeout time.Duration) error {
	if parentPID <= 0 {
		return errors.New("PID pai inválido no ticket de atualização")
	}
	handle, _, callErr := procOpenProcess.Call(processSynchronize, 0, uintptr(parentPID))
	if handle == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == invalidParameterErrno {
			return nil
		}
		return fmt.Errorf("abrir processo anterior: %v", callErr)
	}
	defer procCloseHandle.Call(handle)
	milliseconds := uintptr(timeout / time.Millisecond)
	result, _, waitErr := procWaitForSingleObject.Call(handle, milliseconds)
	switch result {
	case waitObject0:
		return nil
	case waitTimeout:
		return errors.New("a versão anterior não encerrou a tempo; atualização cancelada")
	default:
		return fmt.Errorf("aguardar encerramento da versão anterior: %v", waitErr)
	}
}

func retryRename(source, destination string) error {
	var last error
	for attempt := 0; attempt < 50; attempt++ {
		if err := os.Rename(source, destination); err == nil {
			return nil
		} else {
			last = err
		}
		time.Sleep(100 * time.Millisecond)
	}
	return last
}

func copyUpdateExecutable(source, targetDirectory string, expectedSHA string, expectedSize int64) (string, error) {
	sourceSHA, sourceSize, err := hashUpdateRegularFile(source)
	if err != nil {
		return "", err
	}
	if sourceSHA != expectedSHA || sourceSize != expectedSize {
		return "", errors.New("helper de atualização não corresponde ao executável autorizado")
	}
	sourceFile, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer sourceFile.Close()
	temporary, err := os.CreateTemp(targetDirectory, ".ordax-update-*.exe")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	cleanup := true
	defer func() {
		_ = temporary.Close()
		if cleanup {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o700); err != nil {
		return "", err
	}
	if _, err := io.Copy(temporary, sourceFile); err != nil {
		return "", err
	}
	if err := temporary.Sync(); err != nil {
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	actualSHA, actualSize, err := hashUpdateRegularFile(temporaryPath)
	if err != nil {
		return "", err
	}
	if actualSHA != expectedSHA || actualSize != expectedSize {
		return "", errors.New("cópia local da atualização falhou na verificação SHA-256")
	}
	cleanup = false
	return temporaryPath, nil
}

func waitForUpdateHealth(marker string, child *os.Process, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(data)) == "healthy" {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	if child != nil {
		_ = child.Kill()
	}
	return errors.New("a nova versão não confirmou a inicialização; rollback acionado")
}

func runOwnerSelfUpdateHelper(args []string) error {
	flags := flag.NewFlagSet("ordax-self-update-helper", flag.ContinueOnError)
	ticketPath := flags.String("ticket", "", "validated update ticket")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *ticketPath == "" || flags.NArg() != 0 {
		return errors.New("helper de atualização requer --ticket")
	}
	root, err := ownerUpdateRoot()
	if err != nil {
		return err
	}
	ticketAbs, err := filepath.Abs(*ticketPath)
	if err != nil || !pathInside(root, ticketAbs) {
		return errors.New("ticket de atualização fora da área privada do OrdaX")
	}
	data, err := os.ReadFile(ticketAbs)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > 64<<10 {
		return errors.New("ticket de atualização com tamanho inválido")
	}
	var ticket ownerSelfUpdateTicket
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ticket); err != nil {
		return err
	}
	if ticket.Schema != ownerSelfUpdateTicketSchema || ticket.ParentPID <= 0 ||
		!validLowerHexString(ticket.CurrentSHA256, 64) || !validLowerHexString(ticket.NewSHA256, 64) ||
		!validLowerHexString(ticket.SourceCommit, 40) || ticket.NewSize <= 0 || ticket.NewSize > 256<<20 {
		return errors.New("ticket de atualização inválido")
	}
	targetAbs, err := filepath.Abs(ticket.TargetPath)
	if err != nil || pathInside(root, targetAbs) {
		return errors.New("alvo da atualização inválido")
	}
	helperPath, err := os.Executable()
	if err != nil {
		return err
	}
	helperPath, err = filepath.Abs(helperPath)
	if err != nil || !pathInside(root, helperPath) || !strings.EqualFold(filepath.Dir(helperPath), filepath.Dir(ticketAbs)) {
		return errors.New("helper não está vinculado ao ticket de atualização")
	}
	helperSHA, helperSize, err := hashUpdateRegularFile(helperPath)
	if err != nil || helperSHA != ticket.NewSHA256 || helperSize != ticket.NewSize {
		return errors.New("helper não corresponde ao executável autorizado pelo ticket")
	}
	if err := waitForUpdateParent(ticket.ParentPID, 30*time.Second); err != nil {
		return err
	}
	currentSHA, _, err := hashUpdateRegularFile(targetAbs)
	if err != nil || currentSHA != ticket.CurrentSHA256 {
		return errors.New("o Creator instalado mudou depois da autorização; atualização cancelada")
	}

	targetDirectory := filepath.Dir(targetAbs)
	newPath, err := copyUpdateExecutable(helperPath, targetDirectory, ticket.NewSHA256, ticket.NewSize)
	if err != nil {
		return fmt.Errorf("preparar substituição local: %w", err)
	}
	defer os.Remove(newPath)
	backupPath := filepath.Join(targetDirectory, "."+filepath.Base(targetAbs)+".ordax-previous")
	if info, err := os.Lstat(backupPath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("backup anterior possui tipo inesperado")
		}
		if err := os.Remove(backupPath); err != nil {
			return fmt.Errorf("limpar backup anterior: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := retryRename(targetAbs, backupPath); err != nil {
		return fmt.Errorf("reservar rollback da versão anterior: %w", err)
	}
	restore := true
	defer func() {
		if restore {
			_ = os.Remove(targetAbs)
			_ = retryRename(backupPath, targetAbs)
		}
	}()
	if err := retryRename(newPath, targetAbs); err != nil {
		return fmt.Errorf("ativar novo executável: %w", err)
	}

	healthPath := filepath.Join(filepath.Dir(ticketAbs), "update-health.ok")
	_ = os.Remove(healthPath)
	command := exec.Command(targetAbs, ownerUpdateHealthCommand, healthPath)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	if err := command.Start(); err != nil {
		return fmt.Errorf("reiniciar Creator atualizado: %w", err)
	}
	if err := waitForUpdateHealth(healthPath, command.Process, 20*time.Second); err != nil {
		_ = command.Wait()
		return err
	}
	restore = false
	_ = os.Remove(backupPath)
	_ = os.Remove(ticketAbs)
	_ = os.Remove(healthPath)
	_ = command.Process.Release()
	return nil
}

func markOwnerUpdateHealthy() {
	if updateHealthMarker == "" {
		return
	}
	root, err := ownerUpdateRoot()
	if err != nil || !pathInside(root, updateHealthMarker) {
		return
	}
	_ = os.WriteFile(updateHealthMarker, []byte("healthy\n"), 0o600)
	updateHealthMarker = ""
}

func beginUpdateCheck(manual bool) {
	if writeInProgress() {
		return
	}
	_, currentSource, owner := ownerPrototypeBuildInfo()
	if !owner {
		if manual {
			messageBox("Este build usa o canal de desenvolvimento. O Creator gravável possui o canal de atualização próprio.", "OrdaX Creator", mbOK|mbIconInformation)
		}
		return
	}

	updateMu.Lock()
	if currentUpdateState.Checking || currentUpdateState.Installing {
		updateMu.Unlock()
		return
	}
	currentUpdateState = updateUIState{Checking: true, Manual: manual}
	updateMu.Unlock()
	renderUpdateUI()

	go func() {
		manifest, err := fetchOwnerUpdateManifest()
		state := updateUIState{Manual: manual}
		if err != nil {
			state.Error = err.Error()
		} else {
			state.Version = manifest.Version
			state.SourceCommit = manifest.SourceCommit
			state.DownloadURL = manifest.DownloadURL
			state.SHA256 = manifest.SHA256
			state.Size = manifest.Size
			forward, forwardErr := ownerUpdateIsForward(currentSource, manifest.SourceCommit)
			if forwardErr != nil && manifest.SourceCommit != currentSource {
				state.Error = forwardErr.Error()
			} else {
				state.Available = forward
			}
		}
		updateMu.Lock()
		currentUpdateState = state
		updateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppUpdateDone, 0, 0)
	}()
}

func beginOwnerSelfUpdate(state updateUIState) {
	if writeInProgress() {
		return
	}
	state.Installing = true
	state.Manual = true
	state.Error = ""
	updateMu.Lock()
	currentUpdateState = state
	updateMu.Unlock()
	renderUpdateUI()

	go func() {
		err := stageAndLaunchOwnerSelfUpdate(state)
		updateMu.Lock()
		state.Installing = false
		if err != nil {
			state.Error = err.Error()
		} else {
			state.RestartReady = true
		}
		currentUpdateState = state
		updateMu.Unlock()
		procPostMessageW.Call(mainWindow, wmAppUpdateDone, 0, 0)
	}()
}

func renderUpdateUI() {
	if updateButton == 0 {
		return
	}
	updateMu.Lock()
	state := currentUpdateState
	updateMu.Unlock()
	if writeInProgress() {
		enable(updateButton, false)
		return
	}
	if state.Checking {
		setText(updateButton, "Procurando…")
		enable(updateButton, false)
		return
	}
	if state.Installing {
		setText(updateButton, "Atualizando…")
		enable(updateButton, false)
		return
	}
	if state.Available {
		setText(updateButton, "Atualizar agora")
		enable(updateButton, true)
		return
	}
	setText(updateButton, "Atualizações")
	enable(updateButton, true)
}

func renderUpdateDone() {
	updateMu.Lock()
	state := currentUpdateState
	updateMu.Unlock()
	renderUpdateUI()

	if state.RestartReady {
		messageBox("A atualização foi baixada e validada. O OrdaX Creator será reiniciado agora; se a nova versão não iniciar corretamente, a versão anterior será restaurada automaticamente.", "Atualização pronta", mbOK|mbIconInformation)
		procPostMessageW.Call(mainWindow, wmClose, 0, 0)
		return
	}
	if state.Available && state.Error == "" {
		setText(versionLabel, "OrdaX Creator • "+state.Version+" disponível")
		if state.Manual {
			messageBox("Há uma nova versão do OrdaX Creator. Clique em ‘Atualizar agora’ para baixar, validar e reiniciar automaticamente; não há ZIP para extrair.", "Atualização disponível", mbOK|mbIconInformation)
		}
		return
	}
	if state.Error != "" {
		if state.Manual {
			messageBox("Não foi possível concluir a atualização.\n\n"+state.Error, "OrdaX Creator", mbOK|mbIconError)
		}
		return
	}
	if state.Manual {
		messageBox("Você já está usando a versão mais recente do OrdaX Creator.", "OrdaX Creator", mbOK|mbIconInformation)
	}
}

func handleUpdateButton() {
	if writeInProgress() {
		return
	}
	updateMu.Lock()
	state := currentUpdateState
	updateMu.Unlock()
	if state.Available && state.DownloadURL != "" && state.SHA256 != "" && state.Size > 0 {
		beginOwnerSelfUpdate(state)
		return
	}
	beginUpdateCheck(true)
}

func init() {
	if len(os.Args) >= 2 && os.Args[1] == ownerSelfUpdateHelperCommand {
		if err := runOwnerSelfUpdateHelper(os.Args[2:]); err != nil {
			messageBox("A atualização não pôde ser concluída. A versão anterior foi preservada ou restaurada.\n\n"+err.Error(), "OrdaX Creator", mbOK|mbIconError)
			os.Exit(1)
		}
		os.Exit(0)
	}
	if len(os.Args) == 3 && os.Args[1] == ownerUpdateHealthCommand {
		root, err := ownerUpdateRoot()
		if err == nil {
			marker, markerErr := filepath.Abs(os.Args[2])
			if markerErr == nil && pathInside(root, marker) {
				updateHealthMarker = marker
			}
		}
	}
}
