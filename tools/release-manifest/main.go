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
	"net/url"
	"os"
	"path/filepath"
	"regexp"
)

const (
	manifestSchema = "prototype-ordax.release-manifest/1"
	defaultRepo    = "washingtonmsdj/prototipo-ordax-os"
	defaultRecipe  = "release/native/1"
	maxArtifact    = int64(16 << 30)
)

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	recipePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$`)
)

type Manifest struct {
	Schema              string     `json:"$schema"`
	SourceRepository    string     `json:"source_repository"`
	SourceCommit        string     `json:"source_commit"`
	ReleaseID           string     `json:"release_id"`
	CreatedFromCIRecipe string     `json:"created_from_ci_recipe"`
	Artifacts           []Artifact `json:"artifacts"`
}

type Artifact struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

func ensureRealParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(absolute)
	info, err := os.Lstat(parent)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("parent must be a real directory, not a symlink")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	resolvedAbs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	if filepath.Clean(resolvedAbs) != filepath.Clean(parent) {
		return "", errors.New("parent path may not traverse symlinks")
	}
	return absolute, nil
}

func validateHTTPSURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("artifact URL must be absolute HTTPS without credentials or fragment")
	}
	return nil
}

func hashArtifact(path string) (string, int64, error) {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return "", 0, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", 0, errors.New("artifact must be a regular non-symlink file")
	}
	if filepath.Base(absolute) != "system.tar" {
		return "", 0, errors.New("release-manifest/1 artifact must be named system.tar")
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

func buildManifest(artifactPath, sourceCommit, artifactURL, repository, recipe string) (Manifest, error) {
	if !commitPattern.MatchString(sourceCommit) {
		return Manifest{}, errors.New("source commit must be lowercase 40-hex")
	}
	if repository == "" {
		return Manifest{}, errors.New("source repository is required")
	}
	if !recipePattern.MatchString(recipe) {
		return Manifest{}, errors.New("invalid CI recipe identifier")
	}
	if err := validateHTTPSURL(artifactURL); err != nil {
		return Manifest{}, err
	}
	digest, size, err := hashArtifact(artifactPath)
	if err != nil {
		return Manifest{}, err
	}
	return Manifest{
		Schema:              manifestSchema,
		SourceRepository:    repository,
		SourceCommit:        sourceCommit,
		ReleaseID:           sourceCommit,
		CreatedFromCIRecipe: recipe,
		Artifacts: []Artifact{{
			Name:   "system.tar",
			Role:   "system",
			URL:    artifactURL,
			SHA256: digest,
			Size:   size,
		}},
	}, nil
}

func writeManifest(path string, manifest Manifest) error {
	absolute, err := ensureRealParent(path)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(absolute); err == nil {
		return errors.New("output already exists; overwrite is forbidden")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(absolute)
		}
	}()
	if _, err := io.Copy(file, bytes.NewReader(data)); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	remove = false
	return nil
}

func run(args []string) error {
	flags := flag.NewFlagSet("ordax-release-manifest", flag.ContinueOnError)
	artifact := flags.String("artifact", "", "verified system.tar path")
	commit := flags.String("source-commit", "", "exact lowercase 40-hex source commit")
	artifactURL := flags.String("artifact-url", "", "canonical HTTPS URL for system.tar")
	out := flags.String("out", "", "new release-manifest.json path")
	repository := flags.String("repository", defaultRepo, "source repository")
	recipe := flags.String("recipe", defaultRecipe, "CI recipe identity")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *artifact == "" || *commit == "" || *artifactURL == "" || *out == "" || flags.NArg() != 0 {
		return errors.New("requires --artifact, --source-commit, --artifact-url and --out")
	}
	manifest, err := buildManifest(*artifact, *commit, *artifactURL, *repository, *recipe)
	if err != nil {
		return err
	}
	if err := writeManifest(*out, manifest); err != nil {
		return err
	}
	fmt.Printf("RELEASE_MANIFEST_BUILT=YES\nSOURCE_COMMIT=%s\nSYSTEM_TAR_SHA256=%s\nSYSTEM_TAR_SIZE=%d\n", manifest.SourceCommit, manifest.Artifacts[0].SHA256, manifest.Artifacts[0].Size)
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "ordax-release-manifest: ERROR:", err)
		os.Exit(1)
	}
}
