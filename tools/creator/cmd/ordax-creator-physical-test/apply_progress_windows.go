//go:build windows && ordax_raw_backend

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
)

const applyProgressSchema = "prototype-ordax.creator-physical-progress/1"

func validateApplySidecarPath(imagePath, sidecarPath, expectedBase string) (string, error) {
	sidecarPath = strings.TrimSpace(sidecarPath)
	if sidecarPath == "" {
		return "", nil
	}
	if strings.TrimSpace(imagePath) == "" {
		return "", errors.New("prepared image path is required before sidecar validation")
	}
	imageAbs, err := filepath.Abs(imagePath)
	if err != nil {
		return "", fmt.Errorf("resolve prepared image path: %w", err)
	}
	sidecarAbs, err := filepath.Abs(sidecarPath)
	if err != nil {
		return "", fmt.Errorf("resolve sidecar path: %w", err)
	}
	if !strings.EqualFold(filepath.Base(sidecarAbs), expectedBase) {
		return "", fmt.Errorf("sidecar file must be named %s", expectedBase)
	}
	if !strings.EqualFold(filepath.Clean(filepath.Dir(sidecarAbs)), filepath.Clean(filepath.Dir(imageAbs))) {
		return "", errors.New("sidecar file must remain beside the prepared image")
	}
	if strings.EqualFold(filepath.Clean(sidecarAbs), filepath.Clean(imageAbs)) {
		return "", errors.New("sidecar file cannot replace the prepared image")
	}
	if info, err := os.Lstat(sidecarAbs); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", errors.New("existing sidecar path must be a regular non-symlink file")
		}
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("inspect sidecar path: %w", err)
	}
	return sidecarAbs, nil
}

type applyProgressDocument struct {
	Schema         string `json:"$schema"`
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

func writeApplyProgressSnapshot(path string, progress windowsadapter.PhysicalApplyProgress) error {
	if path == "" {
		return nil
	}
	document := applyProgressDocument{
		Schema:         applyProgressSchema,
		Phase:          progress.Phase,
		CompletedBytes: progress.CompletedBytes,
		TotalBytes:     progress.TotalBytes,
	}
	data, err := json.Marshal(document)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func newApplyProgressReporter(path string) func(windowsadapter.PhysicalApplyProgress) {
	if path == "" {
		return func(windowsadapter.PhysicalApplyProgress) {}
	}
	var mu sync.Mutex
	var lastPhase string
	var lastBytes int64
	var lastWrite time.Time
	return func(progress windowsadapter.PhysicalApplyProgress) {
		mu.Lock()
		defer mu.Unlock()
		now := time.Now()
		force := progress.Phase != lastPhase ||
			(progress.TotalBytes > 0 && progress.CompletedBytes >= progress.TotalBytes) ||
			now.Sub(lastWrite) >= 200*time.Millisecond ||
			progress.CompletedBytes-lastBytes >= 8*1024*1024
		if !force {
			return
		}
		if err := writeApplyProgressSnapshot(path, progress); err != nil {
			return
		}
		lastPhase = progress.Phase
		lastBytes = progress.CompletedBytes
		lastWrite = now
	}
}
