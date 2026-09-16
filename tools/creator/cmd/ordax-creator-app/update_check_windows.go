//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const ownerUpdateManifestURL = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-owner-prototype/creator-owner-update.json"

var procShellExecuteW = shell32.NewProc("ShellExecuteW")

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
	Checking    bool
	Manual      bool
	Available   bool
	Version     string
	SourceCommit string
	DownloadURL string
	Error       string
}

var (
	updateMu    sync.Mutex
	currentUpdateState updateUIState
)

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
	if manifest.Schema != "prototype-ordax.creator-owner-update/1" {
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
		return errors.New("vínculo do pacote de atualização inválido")
	}
	parsed, err := url.Parse(manifest.DownloadURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("URL de atualização inválida")
	}
	if parsed.Path != "/washingtonmsdj/prototipo-ordax-os/releases/download/creator-owner-prototype/OrdaX-Creator-Owner-Prototype.zip" {
		return errors.New("pacote de atualização fora do canal OrdaX")
	}
	return nil
}

func fetchOwnerUpdateManifest() (ownerUpdateManifest, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, ownerUpdateManifestURL+"?ordax_nocache="+fmt.Sprint(time.Now().UnixNano()), nil)
	if err != nil {
		return ownerUpdateManifest{}, err
	}
	req.Header.Set("User-Agent", "OrdaX-Creator-Owner-Updater/1")
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

func beginUpdateCheck(manual bool) {
	if writeInProgress() {
		return
	}
	_, currentSource, owner := ownerPrototypeBuildInfo()
	if !owner {
		if manual {
			messageBox("Este build usa o canal de desenvolvimento. O pacote gravável possui o canal de atualização próprio.", "OrdaX Creator", mbOK|mbIconInformation)
		}
		return
	}

	updateMu.Lock()
	if currentUpdateState.Checking {
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
			state.Available = manifest.SourceCommit != currentSource
		}
		updateMu.Lock()
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
	if state.Available {
		setText(updateButton, "Baixar atualização")
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

	if state.Available {
		setText(versionLabel, "OrdaX Creator • "+state.Version+" disponível")
		if state.Manual {
			messageBox("Há uma nova versão do OrdaX Creator. Clique em ‘Baixar atualização’ para obter o pacote mais recente.", "Atualização disponível", mbOK|mbIconInformation)
		}
		return
	}
	if !state.Manual {
		return
	}
	if state.Error != "" {
		messageBox("Não foi possível verificar atualizações agora.\n\n"+state.Error, "OrdaX Creator", mbOK|mbIconError)
		return
	}
	messageBox("Você já está usando a versão mais recente do OrdaX Creator.", "OrdaX Creator", mbOK|mbIconInformation)
}

func openUpdateDownload(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" {
		return errors.New("URL de atualização inválida")
	}
	result, _, callErr := procShellExecuteW.Call(
		mainWindow,
		uintptr(unsafe.Pointer(utf16Ptr("open"))),
		uintptr(unsafe.Pointer(utf16Ptr(raw))),
		0,
		0,
		uintptr(1),
	)
	if result <= 32 {
		if errno, ok := callErr.(syscall.Errno); ok && errno != 0 {
			return fmt.Errorf("abrir download: %w", errno)
		}
		return fmt.Errorf("o Windows não conseguiu abrir o download (código %d)", result)
	}
	return nil
}

func handleUpdateButton() {
	if writeInProgress() {
		return
	}
	updateMu.Lock()
	state := currentUpdateState
	updateMu.Unlock()
	if state.Available && state.DownloadURL != "" {
		if err := openUpdateDownload(state.DownloadURL); err != nil {
			messageBox(err.Error(), "OrdaX Creator", mbOK|mbIconError)
		}
		return
	}
	beginUpdateCheck(true)
}
