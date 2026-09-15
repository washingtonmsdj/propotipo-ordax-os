package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

const (
	manifestSchema = "prototype-ordax.creator-app-manifest/1"
	purpose        = "creator-app-windows-amd64"
	repository     = "washingtonmsdj/prototipo-ordax-os"
	recipe         = "creator/app/windows/1"
	artifactName   = "OrdaX-Creator-App.exe"
	artifactURL    = "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/creator-app/OrdaX-Creator-App.exe"
	maxArtifact    = int64(128 << 20)
)

var (
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

type artifact struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type manifest struct {
	Schema            string   `json:"$schema"`
	Purpose           string   `json:"purpose"`
	SourceRepository  string   `json:"source_repository"`
	SourceCommit      string   `json:"source_commit"`
	Version           string   `json:"version"`
	ReleaseSequence   int64    `json:"release_sequence"`
	CreatedFromRecipe string   `json:"created_from_recipe"`
	Artifact          artifact `json:"artifact"`
}

func readArtifact(path string) (string, int64, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", 0, err
	}
	if filepath.Base(absolute) != artifactName {
		return "", 0, fmt.Errorf("artifact must be named %s", artifactName)
	}
	parent := filepath.Dir(absolute)
	parentInfo, err := os.Lstat(parent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("artifact parent must be a real directory")
	}
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil || filepath.Clean(resolvedParent) != filepath.Clean(parent) {
		return "", 0, errors.New("artifact path may not traverse symlinks or reparse aliases")
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("artifact must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > maxArtifact {
		return "", 0, fmt.Errorf("artifact size outside allowed range: %d", info.Size())
	}
	file, err := os.Open(absolute)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	n, err := io.Copy(h, file)
	if err != nil {
		return "", 0, err
	}
	if n != info.Size() {
		return "", 0, errors.New("artifact size changed while hashing")
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func writeExclusive(path string, data []byte) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	parent := filepath.Dir(absolute)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	parentInfo, err := os.Lstat(parent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
		return errors.New("manifest output parent must be a real directory")
	}
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil || filepath.Clean(resolvedParent) != filepath.Clean(parent) {
		return errors.New("manifest output path may not traverse symlinks or reparse aliases")
	}
	if _, err := os.Lstat(absolute); err == nil {
		return errors.New("manifest output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func generate(artifactPath, outputPath, sourceCommit, version string, sequence int64) (manifest, error) {
	if !commitPattern.MatchString(sourceCommit) {
		return manifest{}, errors.New("source commit must be lowercase 40-hex")
	}
	if !versionPattern.MatchString(version) {
		return manifest{}, errors.New("Creator app version is invalid")
	}
	if sequence <= 0 {
		return manifest{}, errors.New("release sequence must be positive")
	}
	sha, size, err := readArtifact(artifactPath)
	if err != nil {
		return manifest{}, err
	}
	m := manifest{
		Schema:            manifestSchema,
		Purpose:           purpose,
		SourceRepository:  repository,
		SourceCommit:      sourceCommit,
		Version:           version,
		ReleaseSequence:   sequence,
		CreatedFromRecipe: recipe,
		Artifact: artifact{
			Name:   artifactName,
			URL:    artifactURL,
			SHA256: sha,
			Size:   size,
		},
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return manifest{}, err
	}
	data = append(data, '\n')
	if err := writeExclusive(outputPath, data); err != nil {
		return manifest{}, err
	}
	return m, nil
}

func main() {
	flags := flag.NewFlagSet("ordax-creator-app-manifest", flag.ExitOnError)
	artifactPath := flags.String("artifact", "", "verified Authenticode-signed OrdaX-Creator-App.exe")
	outputPath := flags.String("out", "", "new Creator app manifest")
	sourceCommit := flags.String("source-commit", "", "lowercase 40-hex source commit")
	version := flags.String("version", "", "Creator app version")
	sequence := flags.Int64("release-sequence", 0, "positive monotonic release sequence")
	_ = flags.Parse(os.Args[1:])
	if flags.NArg() != 0 || *artifactPath == "" || *outputPath == "" || *sourceCommit == "" || *version == "" || *sequence <= 0 {
		fmt.Fprintln(os.Stderr, "usage: ordax-creator-app-manifest --artifact FILE --out FILE --source-commit SHA --version VERSION --release-sequence N")
		os.Exit(2)
	}
	m, err := generate(*artifactPath, *outputPath, *sourceCommit, *version, *sequence)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-app-manifest: ERROR:", err)
		os.Exit(1)
	}
	fmt.Printf("CREATOR_APP_MANIFEST_CREATED=YES\nSOURCE_COMMIT=%s\nVERSION=%s\nRELEASE_SEQUENCE=%d\nARTIFACT_SHA256=%s\nARTIFACT_SIZE=%d\nAUTHENTICODE_VERIFICATION_MUST_PRECEDE_THIS_TOOL=YES\n", m.SourceCommit, m.Version, m.ReleaseSequence, m.Artifact.SHA256, m.Artifact.Size)
}
