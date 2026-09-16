//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
)

const physicalProgressSchema = "prototype-ordax.creator-physical-progress/1"

type physicalProgressDocument struct {
	Schema         string `json:"$schema"`
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

func setProgressPercent(percent int) {
	if progressBar == 0 {
		return
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	send(progressBar, pbmSetMarquee, 0, 0)
	send(progressBar, pbmSetPos, uintptr(percent), 0)
}

func readPhysicalProgress(path string) (physicalProgressDocument, error) {
	if path == "" {
		return physicalProgressDocument{}, fmt.Errorf("progress path is empty")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return physicalProgressDocument{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 4096 {
		return physicalProgressDocument{}, fmt.Errorf("progress snapshot is not a small regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return physicalProgressDocument{}, err
	}
	var document physicalProgressDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return physicalProgressDocument{}, err
	}
	if document.Schema != physicalProgressSchema {
		return physicalProgressDocument{}, fmt.Errorf("progress schema is incompatible")
	}
	if document.CompletedBytes < 0 || document.TotalBytes < 0 || (document.TotalBytes > 0 && document.CompletedBytes > document.TotalBytes) {
		return physicalProgressDocument{}, fmt.Errorf("progress byte counters are invalid")
	}
	return document, nil
}

func physicalProgressPresentation(document physicalProgressDocument) (status, hint string, percent int, ok bool) {
	ratioPercent := func(start, span int) int {
		if document.TotalBytes <= 0 {
			return start
		}
		value := start + int((document.CompletedBytes*int64(span))/document.TotalBytes)
		if value < start {
			value = start
		}
		if value > start+span {
			value = start + span
		}
		return value
	}
	byteProgress := func(action string) string {
		if document.TotalBytes <= 0 {
			return action
		}
		const mib = float64(1024 * 1024)
		return fmt.Sprintf("%s %.1f de %.1f MiB.", action, float64(document.CompletedBytes)/mib, float64(document.TotalBytes)/mib)
	}
	switch document.Phase {
	case "starting":
		return "Iniciando gravação elevada…", "O Creator abriu o backend autorizado e está iniciando as verificações finais.", 2, true
	case "checking-elevation":
		return "Confirmando autorização do Windows…", "A operação destrutiva só continua dentro do processo elevado autorizado.", 3, true
	case "revalidating-target":
		return "Confirmando o pendrive selecionado…", "O Creator está conferindo novamente a identidade física do USB antes de qualquer escrita.", 5, true
	case "validating-image":
		return "Validando a imagem preparada…", byteProgress("Validação:"), ratioPercent(5, 7), true
	case "planning-write":
		return "Planejando a gravação otimizada…", "O Creator está validando GPT, regiões necessárias e os limites exatos do dispositivo.", 13, true
	case "locking-target":
		return "Reservando o pendrive com segurança…", "Os volumes do USB estão sendo bloqueados antes da escrita RAW.", 15, true
	case "writing":
		return "Gravando OrdaX no pendrive…", byteProgress("Gravação:"), ratioPercent(15, 45), true
	case "flushing":
		return "Sincronizando dados com o pendrive…", "Os dados gravados estão sendo enviados ao dispositivo antes da leitura de verificação.", 62, true
	case "verifying":
		return "Verificando a gravação por leitura…", byteProgress("Verificação:"), ratioPercent(62, 28), true
	case "verified":
		return "Gravação verificada com sucesso…", "As regiões gravadas conferem com os hashes calculados durante a escrita.", 92, true
	case "formatting-data":
		return "Preparando ORDAX-DATA…", "O espaço restante está sendo formatado em exFAT e validado para uso normal no Windows.", 96, true
	case "complete":
		return "Concluindo criação do pendrive…", "Gravação, verificação e ORDAX-DATA foram concluídos.", 100, true
	default:
		return "", "", 0, false
	}
}

func applyPhysicalProgressSnapshot(path string, lastKey *string) {
	document, err := readPhysicalProgress(path)
	if err != nil {
		return
	}
	key := fmt.Sprintf("%s:%d:%d", document.Phase, document.CompletedBytes, document.TotalBytes)
	if lastKey != nil && *lastKey == key {
		return
	}
	status, hint, percent, ok := physicalProgressPresentation(document)
	if !ok {
		return
	}
	if lastKey != nil {
		*lastKey = key
	}
	updateWritePercentage(status, hint, percent)
}
