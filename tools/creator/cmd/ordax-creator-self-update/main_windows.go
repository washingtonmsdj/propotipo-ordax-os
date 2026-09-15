//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

const (
	processSynchronize = 0x00100000
	waitObject0        = 0x00000000
	waitTimeout        = 0x00000102
	createNoWindow     = 0x08000000
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess   = kernel32.NewProc("OpenProcess")
	procWaitForSingle = kernel32.NewProc("WaitForSingleObject")
	procCloseHandle   = kernel32.NewProc("CloseHandle")
)

func waitForProcess(pid uint32, timeout time.Duration) error {
	handle, _, err := procOpenProcess.Call(processSynchronize, 0, uintptr(pid))
	if handle == 0 {
		return fmt.Errorf("open parent process: %w", err)
	}
	defer procCloseHandle.Call(handle)
	milliseconds := uint32(timeout / time.Millisecond)
	result, _, waitErr := procWaitForSingle.Call(handle, uintptr(milliseconds))
	switch uint32(result) {
	case waitObject0:
		return nil
	case waitTimeout:
		return errors.New("timed out waiting for Creator process to exit")
	default:
		return fmt.Errorf("wait for Creator process: %w", waitErr)
	}
}

func verify(path, expectedHash string, expectedSize int64) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != expectedSize {
		return errors.New("staged Creator size/type mismatch")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return err
	}
	if actual := hex.EncodeToString(h.Sum(nil)); actual != expectedHash {
		return fmt.Errorf("staged Creator hash mismatch: expected=%s actual=%s", expectedHash, actual)
	}
	return nil
}

func sameDirectory(source, target string) bool {
	sourceDir, err1 := filepath.Abs(filepath.Dir(source))
	targetDir, err2 := filepath.Abs(filepath.Dir(target))
	return err1 == nil && err2 == nil && filepath.Clean(sourceDir) == filepath.Clean(targetDir)
}

func replace(source, target, expectedHash string, expectedSize int64) error {
	if !sameDirectory(source, target) {
		return errors.New("staged Creator and target must be in the same directory")
	}
	if filepath.Ext(source) != ".exe" || filepath.Ext(target) != ".exe" {
		return errors.New("Creator replacement paths must be .exe files")
	}
	if err := verify(source, expectedHash, expectedSize); err != nil {
		return err
	}

	backup := target + ".previous"
	_ = os.Remove(backup)
	if err := os.Rename(target, backup); err != nil {
		return fmt.Errorf("preserve previous Creator: %w", err)
	}
	if err := os.Rename(source, target); err != nil {
		_ = os.Rename(backup, target)
		return fmt.Errorf("activate new Creator: %w", err)
	}

	command := exec.Command(target)
	command.Dir = filepath.Dir(target)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := command.Start(); err != nil {
		_ = os.Remove(target)
		_ = os.Rename(backup, target)
		return fmt.Errorf("start updated Creator: %w", err)
	}
	return nil
}

func main() {
	parent := flag.Uint("parent-pid", 0, "Creator process id to wait for")
	source := flag.String("source", "", "verified staged Creator executable")
	target := flag.String("target", "", "current Creator executable to replace")
	hash := flag.String("sha256", "", "expected lowercase SHA-256")
	size := flag.Int64("size", 0, "expected executable size")
	flag.Parse()
	if flag.NArg() != 0 || *parent == 0 || *source == "" || *target == "" || len(*hash) != 64 || *size <= 0 {
		os.Exit(2)
	}
	if _, err := strconv.ParseUint(*hash, 16, 256); err != nil {
		os.Exit(2)
	}
	if err := waitForProcess(uint32(*parent), 45*time.Second); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		err := replace(*source, *target, *hash, *size)
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		time.Sleep(250 * time.Millisecond)
		_ = unsafe.Pointer(nil) // keep windows syscall imports explicit for vet/build parity
	}
}
