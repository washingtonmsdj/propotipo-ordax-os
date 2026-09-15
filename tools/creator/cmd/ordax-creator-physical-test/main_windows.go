//go:build windows && ordax_raw_backend

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
)

var (
	buildSourceCommit        = "UNRESOLVED"
	buildCanonicalTrustSHA256 = "UNRESOLVED"
	buildSeedImageSHA256     = "UNRESOLVED"
	buildSeedImageSize       = "0"
)

type buildBinding struct {
	SourceCommit        string `json:"source_commit"`
	CanonicalTrustSHA256 string `json:"canonical_trust_sha256"`
	SeedImageSHA256     string `json:"seed_image_sha256"`
	SeedImageSize       int64  `json:"seed_image_size"`
	Ready               bool   `json:"ready"`
}

func validLowerHex(value string, bytes int) bool {
	if len(value) != bytes*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytes
}

func binding() buildBinding {
	size, _ := strconv.ParseInt(buildSeedImageSize, 10, 64)
	ready := validLowerHex(buildSourceCommit, 20) &&
		validLowerHex(buildCanonicalTrustSHA256, sha256.Size) &&
		validLowerHex(buildSeedImageSHA256, sha256.Size) &&
		size > 0
	return buildBinding{
		SourceCommit:        buildSourceCommit,
		CanonicalTrustSHA256: buildCanonicalTrustSHA256,
		SeedImageSHA256:     buildSeedImageSHA256,
		SeedImageSize:       size,
		Ready:               ready,
	}
}

func encode(value any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func verifyFile(path, expectedSHA string, expectedSize int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("file must be a regular non-symlink file")
	}
	if info.Size() != expectedSize {
		return fmt.Errorf("file size mismatch: expected=%d actual=%d", expectedSize, info.Size())
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	digest := sha256.New()
	written, err := io.Copy(digest, file)
	if err != nil {
		return err
	}
	if written != expectedSize {
		return fmt.Errorf("hashed file size mismatch: expected=%d actual=%d", expectedSize, written)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA {
		return fmt.Errorf("file SHA-256 mismatch: expected=%s actual=%s", expectedSHA, actual)
	}
	return nil
}

func requireReady() buildBinding {
	b := binding()
	if !b.Ready {
		fmt.Fprintln(os.Stderr, "ordax-creator-physical-test: this build is inspection-only; canonical trust and authorized seed image are not bound")
		os.Exit(1)
	}
	return b
}

func enumerateConfirmed(token string) (windowsadapter.Target, error) {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return windowsadapter.Target{}, err
	}
	return windowsadapter.MatchConfirmedTarget(targets, token)
}

func runStatus() error {
	b := binding()
	return encode(struct {
		Schema                 string       `json:"$schema"`
		Mode                   string       `json:"mode"`
		RawBackendLinked       bool         `json:"raw_backend_linked"`
		PublicCreatorUnaffected bool        `json:"public_creator_unaffected"`
		Build                  buildBinding `json:"build"`
	}{
		Schema:                 "prototype-ordax.creator-physical-test-status/1",
		Mode:                   "physical-test-only",
		RawBackendLinked:       true,
		PublicCreatorUnaffected: true,
		Build:                  b,
	})
}

func runTargets() error {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return err
	}
	return encode(struct {
		Schema  string                  `json:"$schema"`
		Mode    string                  `json:"mode"`
		Targets []windowsadapter.Target `json:"targets"`
	}{
		Schema:  "prototype-ordax.creator-physical-test-targets/1",
		Mode:    "read-only",
		Targets: targets,
	})
}

func runPrepare(args []string) error {
	b := requireReady()
	fs := flag.NewFlagSet("prepare", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from targets")
	seed := fs.String("seed", "", "authorized canonical seed RAW image")
	out := fs.String("out", "", "new target-sized RAW image path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *seed == "" || *out == "" || fs.NArg() != 0 {
		return fmt.Errorf("prepare requires --confirm, --seed and --out")
	}
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	if err := verifyFile(*seed, b.SeedImageSHA256, b.SeedImageSize); err != nil {
		return fmt.Errorf("verify authorized seed image: %w", err)
	}
	prepared, err := creatorcore.PreparePhysicalImage(*seed, *out, target.PhysicalDiskBytes)
	if err != nil {
		return err
	}
	image := windowsadapter.VerifiedRawImage{
		Path:      prepared.Path,
		SizeBytes: prepared.SizeBytes,
		SHA256:    prepared.SHA256,
	}
	authorization := windowsadapter.DestructiveAuthorizationToken(target, image)
	return encode(struct {
		Schema                   string                         `json:"$schema"`
		SourceCommit             string                         `json:"source_commit"`
		CanonicalTrustSHA256     string                         `json:"canonical_trust_sha256"`
		AuthorizedSeedSHA256     string                         `json:"authorized_seed_sha256"`
		Target                   windowsadapter.Target          `json:"target"`
		PreparedImage            creatorcore.PreparedPhysicalImage `json:"prepared_image"`
		DestructiveAuthorization string                         `json:"destructive_authorization"`
		Next                     string                         `json:"next"`
	}{
		Schema:                   "prototype-ordax.creator-physical-test-preparation/1",
		SourceCommit:             b.SourceCommit,
		CanonicalTrustSHA256:     b.CanonicalTrustSHA256,
		AuthorizedSeedSHA256:     b.SeedImageSHA256,
		Target:                   target,
		PreparedImage:            prepared,
		DestructiveAuthorization: authorization,
		Next:                     "run apply from an elevated terminal with the exact same target token, image SHA/size and destructive authorization token",
	})
}

func runApply(args []string) error {
	_ = requireReady()
	fs := flag.NewFlagSet("apply", flag.ContinueOnError)
	confirm := fs.String("confirm", "", "confirmation token from the selected target")
	imagePath := fs.String("image", "", "prepared target-sized RAW image")
	imageSHA := fs.String("sha256", "", "prepared image SHA-256")
	imageSize := fs.Int64("size", 0, "prepared image size in bytes")
	authorize := fs.String("authorize", "", "destructive authorization token emitted by prepare")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *imagePath == "" || *imageSHA == "" || *imageSize <= 0 || *authorize == "" || fs.NArg() != 0 {
		return fmt.Errorf("apply requires --confirm, --image, --sha256, --size and --authorize")
	}
	target, err := enumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	verified, err := windowsadapter.VerifyRawImage(*imagePath, *imageSHA, *imageSize)
	if err != nil {
		return fmt.Errorf("verify prepared image: %w", err)
	}
	request := windowsadapter.RawDiskApplyRequest{
		Target:                   target,
		ConfirmationToken:        *confirm,
		Image:                    verified,
		CanonicalTrustResolved:   true,
		DestructiveAuthorization: *authorize,
	}
	result, err := windowsadapter.ApplyPhysicalTest(request)
	if err != nil {
		return err
	}
	return encode(struct {
		Schema string                             `json:"$schema"`
		Status string                             `json:"status"`
		Result windowsadapter.PhysicalApplyResult `json:"result"`
	}{
		Schema: "prototype-ordax.creator-physical-test-apply/1",
		Status: "pass-readback-verified",
		Result: result,
	})
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-creator-physical-test <status|targets|prepare|apply> [options]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "status":
		err = runStatus()
	case "targets":
		err = runTargets()
	case "prepare":
		err = runPrepare(os.Args[2:])
	case "apply":
		err = runApply(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ordax-creator-physical-test:", err)
		os.Exit(1)
	}
}
