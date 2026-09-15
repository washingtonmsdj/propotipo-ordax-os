package creatorcore

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type DisposableTreeProof struct {
	Schema           string `json:"$schema"`
	ArtifactCount    int    `json:"artifact_count"`
	RuntimeRootCount int    `json:"runtime_root_count"`
}

func partitionRelativeTarget(partition string, targetPath string) (string, error) {
	if !validTargetPath(targetPath) {
		return "", errors.New("target path is not a clean absolute path")
	}
	switch partition {
	case "ORDAX-ESP":
		if targetPath == "/ordax" || strings.HasPrefix(targetPath, "/ordax/") {
			return "", errors.New("ESP target may not use the /ordax runtime namespace")
		}
		return strings.TrimPrefix(targetPath, "/"), nil
	case "ORDAX":
		if !strings.HasPrefix(targetPath, "/ordax/") {
			return "", errors.New("ORDAX target must live below /ordax")
		}
		relative := strings.TrimPrefix(targetPath, "/ordax/")
		if relative == "" || relative == "." || strings.HasPrefix(relative, "../") {
			return "", errors.New("ORDAX target does not name a path below /ordax")
		}
		return relative, nil
	default:
		return "", fmt.Errorf("unknown partition %q", partition)
	}
}

func ensureEmptyRealDirectory(root string) (string, error) {
	if root == "" {
		return "", errors.New("output root is required")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve output root: %w", err)
	}
	info, err := os.Lstat(rootAbs)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(rootAbs, 0o755); err != nil {
			return "", fmt.Errorf("create output root: %w", err)
		}
		info, err = os.Lstat(rootAbs)
	}
	if err != nil {
		return "", fmt.Errorf("stat output root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", errors.New("output root must be a real directory, not a symlink")
	}
	entries, err := os.ReadDir(rootAbs)
	if err != nil {
		return "", fmt.Errorf("read output root: %w", err)
	}
	if len(entries) != 0 {
		return "", errors.New("output root must be empty")
	}
	return rootAbs, nil
}

func parsedMode(value string) (os.FileMode, error) {
	parsed, err := strconv.ParseUint(value, 8, 32)
	if err != nil {
		return 0, err
	}
	return os.FileMode(parsed), nil
}

func hashRegularFile(filePath string) (string, error) {
	info, err := os.Lstat(filePath)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("path is not a regular non-symlink file")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// StageDisposableTree verifies the fully resolved Creator payload and copies it
// into an empty directory mirror containing exactly ORDAX-ESP/ and ORDAX/ roots.
// This proves logical target mapping and post-copy byte integrity only. It is not
// a GPT, FAT32, ext4, firmware-boot or physical-media authorization proof.
func StageDisposableTree(m Manifest, payloadRoot string, outputRoot string) (DisposableTreeProof, error) {
	plan, err := buildArtifactPlan(m, false)
	if err != nil {
		return DisposableTreeProof{}, err
	}
	if _, err := VerifyPayload(m, payloadRoot); err != nil {
		return DisposableTreeProof{}, err
	}
	outputAbs, err := ensureEmptyRealDirectory(outputRoot)
	if err != nil {
		return DisposableTreeProof{}, err
	}
	partitionRoots := map[string]string{
		"ORDAX-ESP": filepath.Join(outputAbs, "ORDAX-ESP"),
		"ORDAX":     filepath.Join(outputAbs, "ORDAX"),
	}
	for _, partitionName := range []string{"ORDAX-ESP", "ORDAX"} {
		if err := os.Mkdir(partitionRoots[partitionName], 0o755); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("create %s mirror: %w", partitionName, err)
		}
	}

	for _, artifact := range plan.Artifacts {
		relativeTarget, err := partitionRelativeTarget(artifact.Partition, artifact.TargetPath)
		if err != nil {
			return DisposableTreeProof{}, fmt.Errorf("unsafe target %q on %s: %w", artifact.TargetPath, artifact.Partition, err)
		}
		source := filepath.Join(payloadRoot, filepath.FromSlash(artifact.SourcePath))
		target := filepath.Join(partitionRoots[artifact.Partition], filepath.FromSlash(relativeTarget))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("create parent for %q: %w", artifact.TargetPath, err)
		}
		mode, err := parsedMode(artifact.Mode)
		if err != nil {
			return DisposableTreeProof{}, fmt.Errorf("parse mode for %q: %w", artifact.TargetPath, err)
		}
		input, err := os.Open(source)
		if err != nil {
			return DisposableTreeProof{}, fmt.Errorf("open source %q: %w", artifact.SourcePath, err)
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			input.Close()
			return DisposableTreeProof{}, fmt.Errorf("create target %q: %w", artifact.TargetPath, err)
		}
		_, copyErr := io.Copy(output, input)
		inputCloseErr := input.Close()
		syncErr := output.Sync()
		closeErr := output.Close()
		if copyErr != nil {
			return DisposableTreeProof{}, fmt.Errorf("copy target %q: %w", artifact.TargetPath, copyErr)
		}
		if inputCloseErr != nil {
			return DisposableTreeProof{}, fmt.Errorf("close source %q: %w", artifact.SourcePath, inputCloseErr)
		}
		if syncErr != nil {
			return DisposableTreeProof{}, fmt.Errorf("sync target %q: %w", artifact.TargetPath, syncErr)
		}
		if closeErr != nil {
			return DisposableTreeProof{}, fmt.Errorf("close target %q: %w", artifact.TargetPath, closeErr)
		}
		if err := os.Chmod(target, mode); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("chmod target %q: %w", artifact.TargetPath, err)
		}
		actual, err := hashRegularFile(target)
		if err != nil {
			return DisposableTreeProof{}, fmt.Errorf("rehash target %q: %w", artifact.TargetPath, err)
		}
		if actual != artifact.SHA256 {
			return DisposableTreeProof{}, fmt.Errorf("target %q SHA-256 mismatch: expected=%s actual=%s", artifact.TargetPath, artifact.SHA256, actual)
		}
	}

	seenRuntimeRoots := map[string]bool{}
	for _, runtimeRoot := range m.RuntimeRootsCreatedEmpty {
		if seenRuntimeRoots[runtimeRoot] {
			return DisposableTreeProof{}, fmt.Errorf("duplicate runtime root %q", runtimeRoot)
		}
		seenRuntimeRoots[runtimeRoot] = true
		relative, err := partitionRelativeTarget("ORDAX", runtimeRoot)
		if err != nil {
			return DisposableTreeProof{}, fmt.Errorf("invalid runtime root %q: %w", runtimeRoot, err)
		}
		if err := os.MkdirAll(filepath.Join(partitionRoots["ORDAX"], filepath.FromSlash(relative)), 0o755); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("create runtime root %q: %w", runtimeRoot, err)
		}
	}

	return DisposableTreeProof{
		Schema:           "prototype-ordax.creator-disposable-tree-proof/1",
		ArtifactCount:    len(plan.Artifacts),
		RuntimeRootCount: len(m.RuntimeRootsCreatedEmpty),
	}, nil
}
