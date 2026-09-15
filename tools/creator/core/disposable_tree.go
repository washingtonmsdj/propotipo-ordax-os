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

type preparedDisposableArtifact struct {
	partition      string
	targetPath     string
	sourcePath     string
	expectedSHA256 string
	mode           os.FileMode
	relativeTarget string
}

type disposableOutputTarget struct {
	path    string
	parent  string
	existed bool
}

func partitionRelativeTarget(partition string, targetPath string) (string, error) {
	if !validTargetPath(targetPath) {
		return "", errors.New("target path is not a clean absolute path")
	}
	switch partition {
	case "ORDAX-ESP":
		// ESP targets are paths inside the FAT filesystem. The canonical boot
		// contract intentionally stores kernel/initramfs bytes below /ordax on
		// that filesystem; this does not refer to the ORDAX partition's
		// /ordax runtime namespace.
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

func prepareDisposableOutputTarget(root string) (disposableOutputTarget, error) {
	if root == "" {
		return disposableOutputTarget{}, errors.New("output root is required")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return disposableOutputTarget{}, fmt.Errorf("resolve output root: %w", err)
	}
	parent := filepath.Dir(rootAbs)
	parentInfo, err := os.Lstat(parent)
	if err != nil {
		return disposableOutputTarget{}, fmt.Errorf("stat output parent: %w", err)
	}
	if parentInfo.Mode()&os.ModeSymlink != 0 || !parentInfo.IsDir() {
		return disposableOutputTarget{}, errors.New("output parent must be a real directory, not a symlink")
	}

	info, err := os.Lstat(rootAbs)
	if errors.Is(err, os.ErrNotExist) {
		return disposableOutputTarget{path: rootAbs, parent: parent, existed: false}, nil
	}
	if err != nil {
		return disposableOutputTarget{}, fmt.Errorf("stat output root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return disposableOutputTarget{}, errors.New("output root must be a real directory, not a symlink")
	}
	entries, err := os.ReadDir(rootAbs)
	if err != nil {
		return disposableOutputTarget{}, fmt.Errorf("read output root: %w", err)
	}
	if len(entries) != 0 {
		return disposableOutputTarget{}, errors.New("output root must be empty")
	}
	return disposableOutputTarget{path: rootAbs, parent: parent, existed: true}, nil
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

func prepareDisposableTreePlan(m Manifest, payloadRoot string) ([]preparedDisposableArtifact, []string, error) {
	plan, err := buildArtifactPlan(m, false)
	if err != nil {
		return nil, nil, err
	}
	if _, err := VerifyPayload(m, payloadRoot); err != nil {
		return nil, nil, err
	}

	prepared := make([]preparedDisposableArtifact, 0, len(plan.Artifacts))
	for _, artifact := range plan.Artifacts {
		relativeTarget, err := partitionRelativeTarget(artifact.Partition, artifact.TargetPath)
		if err != nil {
			return nil, nil, fmt.Errorf("unsafe target %q on %s: %w", artifact.TargetPath, artifact.Partition, err)
		}
		mode, err := parsedMode(artifact.Mode)
		if err != nil {
			return nil, nil, fmt.Errorf("parse mode for %q: %w", artifact.TargetPath, err)
		}
		prepared = append(prepared, preparedDisposableArtifact{
			partition:      artifact.Partition,
			targetPath:     artifact.TargetPath,
			sourcePath:     filepath.Join(payloadRoot, filepath.FromSlash(artifact.SourcePath)),
			expectedSHA256: artifact.SHA256,
			mode:           mode,
			relativeTarget: relativeTarget,
		})
	}

	seenRuntimeRoots := map[string]bool{}
	runtimeRoots := make([]string, 0, len(m.RuntimeRootsCreatedEmpty))
	for _, runtimeRoot := range m.RuntimeRootsCreatedEmpty {
		if seenRuntimeRoots[runtimeRoot] {
			return nil, nil, fmt.Errorf("duplicate runtime root %q", runtimeRoot)
		}
		seenRuntimeRoots[runtimeRoot] = true
		relative, err := partitionRelativeTarget("ORDAX", runtimeRoot)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid runtime root %q: %w", runtimeRoot, err)
		}
		runtimeRoots = append(runtimeRoots, relative)
	}
	return prepared, runtimeRoots, nil
}

func copyDisposableArtifact(artifact preparedDisposableArtifact, partitionRoot string) error {
	target := filepath.Join(partitionRoot, filepath.FromSlash(artifact.relativeTarget))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create parent for %q: %w", artifact.targetPath, err)
	}
	input, err := os.Open(artifact.sourcePath)
	if err != nil {
		return fmt.Errorf("open source for %q: %w", artifact.targetPath, err)
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		input.Close()
		return fmt.Errorf("create target %q: %w", artifact.targetPath, err)
	}

	_, copyErr := io.Copy(output, input)
	inputCloseErr := input.Close()
	chmodErr := output.Chmod(artifact.mode)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return fmt.Errorf("copy target %q: %w", artifact.targetPath, copyErr)
	}
	if inputCloseErr != nil {
		return fmt.Errorf("close source for %q: %w", artifact.targetPath, inputCloseErr)
	}
	if chmodErr != nil {
		return fmt.Errorf("chmod target %q: %w", artifact.targetPath, chmodErr)
	}
	if syncErr != nil {
		return fmt.Errorf("sync target %q: %w", artifact.targetPath, syncErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close target %q: %w", artifact.targetPath, closeErr)
	}
	actual, err := hashRegularFile(target)
	if err != nil {
		return fmt.Errorf("rehash target %q: %w", artifact.targetPath, err)
	}
	if actual != artifact.expectedSHA256 {
		return fmt.Errorf("target %q SHA-256 mismatch: expected=%s actual=%s", artifact.targetPath, artifact.expectedSHA256, actual)
	}
	return nil
}

func publishDisposableTree(stagingRoot string, output disposableOutputTarget) error {
	if err := os.Rename(stagingRoot, output.path); err == nil {
		return nil
	} else if !output.existed {
		return fmt.Errorf("publish disposable tree: %w", err)
	}

	// Some platforms do not replace an existing empty directory with Rename.
	// Preserve the caller's empty output on publication failure by moving it to
	// an empty sibling backup first, restoring it if the final rename fails.
	backup, err := os.MkdirTemp(output.parent, "."+filepath.Base(output.path)+".empty-")
	if err != nil {
		return fmt.Errorf("reserve output backup: %w", err)
	}
	if err := os.Remove(backup); err != nil {
		return fmt.Errorf("prepare output backup: %w", err)
	}
	if err := os.Rename(output.path, backup); err != nil {
		return fmt.Errorf("preserve existing empty output: %w", err)
	}
	if err := os.Rename(stagingRoot, output.path); err != nil {
		restoreErr := os.Rename(backup, output.path)
		if restoreErr != nil {
			return fmt.Errorf("publish disposable tree: %w; restore empty output: %v", err, restoreErr)
		}
		return fmt.Errorf("publish disposable tree: %w", err)
	}
	if err := os.Remove(backup); err != nil {
		return fmt.Errorf("remove preserved empty output after publication: %w", err)
	}
	return nil
}

// StageDisposableTree verifies the fully resolved Creator payload and stages it
// transactionally into a directory mirror containing exactly ORDAX-ESP/ and
// ORDAX/ roots. No payload bytes are published at outputRoot until every source,
// target, mode, runtime root, copy and post-copy SHA-256 check succeeds.
//
// This proves logical target mapping and post-copy byte integrity only. It is not
// a GPT, FAT32, ext4, firmware-boot or physical-media authorization proof.
func StageDisposableTree(m Manifest, payloadRoot string, outputRoot string) (DisposableTreeProof, error) {
	artifacts, runtimeRoots, err := prepareDisposableTreePlan(m, payloadRoot)
	if err != nil {
		return DisposableTreeProof{}, err
	}
	output, err := prepareDisposableOutputTarget(outputRoot)
	if err != nil {
		return DisposableTreeProof{}, err
	}

	stagingRoot, err := os.MkdirTemp(output.parent, "."+filepath.Base(output.path)+".stage-")
	if err != nil {
		return DisposableTreeProof{}, fmt.Errorf("create staging root: %w", err)
	}
	published := false
	defer func() {
		if !published {
			_ = os.RemoveAll(stagingRoot)
		}
	}()
	if err := os.Chmod(stagingRoot, 0o755); err != nil {
		return DisposableTreeProof{}, fmt.Errorf("chmod staging root: %w", err)
	}

	partitionRoots := map[string]string{
		"ORDAX-ESP": filepath.Join(stagingRoot, "ORDAX-ESP"),
		"ORDAX":     filepath.Join(stagingRoot, "ORDAX"),
	}
	for _, partitionName := range []string{"ORDAX-ESP", "ORDAX"} {
		if err := os.Mkdir(partitionRoots[partitionName], 0o755); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("create %s mirror: %w", partitionName, err)
		}
	}

	for _, artifact := range artifacts {
		if err := copyDisposableArtifact(artifact, partitionRoots[artifact.partition]); err != nil {
			return DisposableTreeProof{}, err
		}
	}
	for _, relative := range runtimeRoots {
		if err := os.MkdirAll(filepath.Join(partitionRoots["ORDAX"], filepath.FromSlash(relative)), 0o755); err != nil {
			return DisposableTreeProof{}, fmt.Errorf("create runtime root %q: %w", "/ordax/"+relative, err)
		}
	}

	if err := publishDisposableTree(stagingRoot, output); err != nil {
		return DisposableTreeProof{}, err
	}
	published = true
	return DisposableTreeProof{
		Schema:           "prototype-ordax.creator-disposable-tree-proof/1",
		ArtifactCount:    len(artifacts),
		RuntimeRootCount: len(runtimeRoots),
	}, nil
}
