package main

import (
	"archive/tar"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxBundleSize = int64(16 << 30)
	maxEntries    = 100000
)

type sourceEntry struct {
	name string
	path string
	info fs.FileInfo
}

func ensureRealDirectory(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("path must be a real directory, not a symlink")
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(absolute) {
		return "", errors.New("directory path may not traverse symlinks")
	}
	return absolute, nil
}

func ensureOutputPath(path, systemRoot string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent, err := ensureRealDirectory(filepath.Dir(absolute))
	if err != nil {
		return "", fmt.Errorf("output parent: %w", err)
	}
	absolute = filepath.Join(parent, filepath.Base(absolute))
	if _, err := os.Lstat(absolute); err == nil {
		return "", errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	rel, err := filepath.Rel(systemRoot, absolute)
	if err != nil {
		return "", err
	}
	if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
		return "", errors.New("output must not be created inside the system source tree")
	}
	return absolute, nil
}

func validateEntry(name string, info fs.FileInfo) error {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("unsafe bundle path: %q", name)
	}
	mode := info.Mode()
	if mode&os.ModeSymlink != 0 {
		return fmt.Errorf("symlinks are forbidden in release bundles: %s", name)
	}
	if info.IsDir() {
		if mode.Perm() != 0o755 {
			return fmt.Errorf("bundle directory mode must be 0755: %s", name)
		}
		return nil
	}
	if !mode.IsRegular() {
		return fmt.Errorf("only regular files and directories are allowed: %s", name)
	}
	if mode.Perm() != 0o644 && mode.Perm() != 0o755 {
		return fmt.Errorf("bundle file mode must be 0644 or 0755: %s", name)
	}
	if info.Size() < 0 || info.Size() > maxBundleSize {
		return fmt.Errorf("bundle file size outside allowed range: %s", name)
	}
	return nil
}

func collectEntries(root string) ([]sourceEntry, int64, error) {
	rootAbs, err := ensureRealDirectory(root)
	if err != nil {
		return nil, 0, err
	}
	systemRoot := filepath.Join(rootAbs, "system")
	systemInfo, err := os.Lstat(systemRoot)
	if err != nil {
		return nil, 0, fmt.Errorf("system root: %w", err)
	}
	if !systemInfo.IsDir() || systemInfo.Mode()&os.ModeSymlink != 0 || systemInfo.Mode().Perm() != 0o755 {
		return nil, 0, errors.New("system/ must be a real 0755 directory")
	}

	entries := make([]sourceEntry, 0, 128)
	var total int64
	entrypointSeen := false
	err = filepath.WalkDir(systemRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if len(entries) >= maxEntries {
			return errors.New("system tree exceeds maximum entry count")
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(rootAbs, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if err := validateEntry(name, info); err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
			if total > maxBundleSize {
				return errors.New("system tree exceeds maximum extracted size")
			}
			if name == "system/entrypoint" {
				if info.Mode().Perm() != 0o755 || info.Size() == 0 {
					return errors.New("system/entrypoint must be a non-empty 0755 regular file")
				}
				entrypointSeen = true
			}
		}
		entries = append(entries, sourceEntry{name: name, path: path, info: info})
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	if !entrypointSeen {
		return nil, 0, errors.New("system tree does not contain executable system/entrypoint")
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	return entries, total, nil
}

func writeBundle(root, output string) (string, int64, error) {
	rootAbs, err := ensureRealDirectory(root)
	if err != nil {
		return "", 0, err
	}
	entries, _, err := collectEntries(rootAbs)
	if err != nil {
		return "", 0, err
	}
	systemRoot := filepath.Join(rootAbs, "system")
	outputAbs, err := ensureOutputPath(output, systemRoot)
	if err != nil {
		return "", 0, err
	}
	file, err := os.OpenFile(outputAbs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", 0, err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(outputAbs)
		}
	}()
	h := sha256.New()
	writer := tar.NewWriter(io.MultiWriter(file, h))
	epoch := time.Unix(0, 0).UTC()
	for _, entry := range entries {
		name := entry.name
		typeflag := byte(tar.TypeReg)
		size := entry.info.Size()
		if entry.info.IsDir() {
			typeflag = tar.TypeDir
			size = 0
			name += "/"
		}
		header := &tar.Header{
			Name:       name,
			Mode:       int64(entry.info.Mode().Perm()),
			Uid:        0,
			Gid:        0,
			Size:       size,
			ModTime:    epoch,
			AccessTime: time.Time{},
			ChangeTime: time.Time{},
			Typeflag:   typeflag,
			Format:     tar.FormatUSTAR,
		}
		if err := writer.WriteHeader(header); err != nil {
			_ = writer.Close()
			_ = file.Close()
			return "", 0, err
		}
		if typeflag == tar.TypeReg {
			input, err := os.Open(entry.path)
			if err != nil {
				_ = writer.Close()
				_ = file.Close()
				return "", 0, err
			}
			info, statErr := input.Stat()
			if statErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != entry.info.Mode().Perm() || info.Size() != entry.info.Size() {
				_ = input.Close()
				_ = writer.Close()
				_ = file.Close()
				return "", 0, fmt.Errorf("source changed during bundle build: %s", entry.name)
			}
			n, copyErr := io.CopyN(writer, input, entry.info.Size())
			closeErr := input.Close()
			if copyErr != nil || n != entry.info.Size() {
				_ = writer.Close()
				_ = file.Close()
				return "", 0, fmt.Errorf("copy source file %s: %w", entry.name, copyErr)
			}
			if closeErr != nil {
				_ = writer.Close()
				_ = file.Close()
				return "", 0, closeErr
			}
		}
	}
	if err := writer.Close(); err != nil {
		_ = file.Close()
		return "", 0, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return "", 0, err
	}
	if err := file.Close(); err != nil {
		return "", 0, err
	}
	info, err := os.Stat(outputAbs)
	if err != nil {
		return "", 0, err
	}
	remove = false
	return hex.EncodeToString(h.Sum(nil)), info.Size(), nil
}

func run(args []string) error {
	flags := flag.NewFlagSet("ordax-release-bundle", flag.ContinueOnError)
	root := flags.String("root", "", "source root containing system/")
	out := flags.String("out", "", "new deterministic system.tar path")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *root == "" || *out == "" || flags.NArg() != 0 {
		return errors.New("requires --root and --out")
	}
	digest, size, err := writeBundle(*root, *out)
	if err != nil {
		return err
	}
	fmt.Printf("SYSTEM_TAR_BUILT=YES\nSHA256=%s\nSIZE=%d\n", digest, size)
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-bundle: ERROR:", err)
		os.Exit(1)
	}
}
