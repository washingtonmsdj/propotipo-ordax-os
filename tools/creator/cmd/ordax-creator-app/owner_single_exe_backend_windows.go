//go:build windows && ordax_owner_prototype && ordax_single_exe && ordax_raw_backend

package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
	windowsadapter "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/host/windows"
)

var (
	// The standalone owner build embeds only a compressed seed and provenance.
	// The elevated helper is a byte-identical copy of this same executable, so
	// the public distribution remains exactly one EXE.
	//go:embed owner_payload/ordax-bootstrap-seed.raw.gz
	embeddedOwnerSeedGzip []byte

	//go:embed owner_payload/provenance.json
	embeddedOwnerProvenance []byte

	ownerRuntimeOnce sync.Once
	ownerRuntimeDir  string
	ownerRuntimeErr  error

	ownerApplyDiagnosticLog string
)

type ownerPrototypeProvenance struct {
	Schema                          string `json:"$schema"`
	Status                          string `json:"status"`
	SourceCommit                    string `json:"source_commit"`
	CanonicalPublicRelease          bool   `json:"canonical_public_release"`
	EphemeralPrototypeTrust         bool   `json:"ephemeral_prototype_trust"`
	PrivateKeyInPackage             bool   `json:"private_key_in_package"`
	RawBackendLinked                bool   `json:"raw_backend_linked"`
	PhysicalWriteAuthorizedInBinary bool   `json:"physical_write_authorized_in_binary"`
	SystemDiskExclusionRequired     bool   `json:"system_disk_exclusion_required"`
	LiveTargetRevalidationRequired  bool   `json:"live_target_revalidation_required"`
	WindowsUACRequired              bool   `json:"windows_uac_required"`
	ReadbackVerificationRequired    bool   `json:"readback_verification_required"`
	TrustSHA256                     string `json:"trust_sha256"`
	PrototypeManifestSHA256         string `json:"prototype_manifest_sha256"`
	SeedSHA256                      string `json:"seed_sha256"`
	SeedSize                        int64  `json:"seed_size"`
}

type ownerBuildBinding struct {
	SourceCommit            string `json:"source_commit"`
	CanonicalTrustSHA256    string `json:"canonical_trust_sha256"`
	ManifestSHA256          string `json:"manifest_sha256"`
	SeedImageSHA256         string `json:"seed_image_sha256"`
	SeedImageSize           int64  `json:"seed_image_size"`
	PhysicalWriteAuthorized bool   `json:"physical_write_authorized"`
	Ready                   bool   `json:"ready"`
}

type ownerApplyProgressDocument struct {
	Schema         string `json:"$schema"`
	Phase          string `json:"phase"`
	CompletedBytes int64  `json:"completed_bytes"`
	TotalBytes     int64  `json:"total_bytes"`
}

func validOwnerHex(value string, size int) bool {
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

func validOwnerSourceCommit(value string) bool { return validOwnerHex(value, 40) }

func decodeOwnerProvenance() (ownerPrototypeProvenance, error) {
	var provenance ownerPrototypeProvenance
	decoder := json.NewDecoder(bytes.NewReader(embeddedOwnerProvenance))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&provenance); err != nil {
		return ownerPrototypeProvenance{}, fmt.Errorf("ler proveniência incorporada: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ownerPrototypeProvenance{}, errors.New("proveniência incorporada contém dados extras")
	}
	if provenance.Schema != "prototype-ordax.creator-owner-physical/1" ||
		provenance.Status != "owner-prototype-write-enabled" ||
		!validOwnerSourceCommit(provenance.SourceCommit) ||
		provenance.CanonicalPublicRelease ||
		!provenance.EphemeralPrototypeTrust ||
		provenance.PrivateKeyInPackage ||
		!provenance.RawBackendLinked ||
		!provenance.PhysicalWriteAuthorizedInBinary ||
		!provenance.SystemDiskExclusionRequired ||
		!provenance.LiveTargetRevalidationRequired ||
		!provenance.WindowsUACRequired ||
		!provenance.ReadbackVerificationRequired ||
		!validOwnerHex(provenance.TrustSHA256, 64) ||
		!validOwnerHex(provenance.PrototypeManifestSHA256, 64) ||
		!validOwnerHex(provenance.SeedSHA256, 64) ||
		provenance.SeedSize <= 0 {
		return ownerPrototypeProvenance{}, errors.New("proveniência incorporada não satisfaz o contrato físico do Owner")
	}
	return provenance, nil
}

func ownerBinding(provenance ownerPrototypeProvenance) ownerBuildBinding {
	return ownerBuildBinding{
		SourceCommit:            provenance.SourceCommit,
		CanonicalTrustSHA256:    provenance.TrustSHA256,
		ManifestSHA256:          provenance.PrototypeManifestSHA256,
		SeedImageSHA256:         provenance.SeedSHA256,
		SeedImageSize:           provenance.SeedSize,
		PhysicalWriteAuthorized: provenance.PhysicalWriteAuthorizedInBinary,
		Ready:                   provenance.PhysicalWriteAuthorizedInBinary,
	}
}

func ownerPrototypeBuildInfo() (version string, sourceCommit string, ok bool) {
	provenance, err := decodeOwnerProvenance()
	if err != nil {
		return "", "", false
	}
	return "owner-" + provenance.SourceCommit[:12], provenance.SourceCommit, true
}

func hashBytes(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func verifyRegularFile(path, expectedSHA string, expectedSize int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return errors.New("arquivo deve ser regular e não pode ser link")
	}
	if info.Size() != expectedSize {
		return fmt.Errorf("tamanho inesperado: esperado=%d atual=%d", expectedSize, info.Size())
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
		return fmt.Errorf("leitura incompleta: esperado=%d atual=%d", expectedSize, written)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA {
		return fmt.Errorf("SHA-256 inesperado: esperado=%s atual=%s", expectedSHA, actual)
	}
	return nil
}

func writeAtomic(path string, mode os.FileMode, write func(*os.File) error) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".ordax-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	cleanup := true
	defer func() {
		_ = temporary.Close()
		if cleanup {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if err := write(temporary); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func materializeOwnerRuntime() (string, error) {
	provenance, err := decodeOwnerProvenance()
	if err != nil {
		return "", err
	}
	root := filepath.Join(os.TempDir(), "OrdaX-Creator")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("criar área privada do Creator: %w", err)
	}
	directory, err := os.MkdirTemp(root, "standalone-*")
	if err != nil {
		return "", fmt.Errorf("criar runtime privado do Creator: %w", err)
	}

	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("localizar OrdaX-Creator.exe: %w", err)
	}
	sourceInfo, err := os.Lstat(executable)
	if err != nil || !sourceInfo.Mode().IsRegular() || sourceInfo.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("OrdaX-Creator.exe atual não é um arquivo regular confiável")
	}
	source, err := os.Open(executable)
	if err != nil {
		return "", err
	}
	sourceDigest := sha256.New()
	if _, err := io.Copy(sourceDigest, source); err != nil {
		_ = source.Close()
		return "", err
	}
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		_ = source.Close()
		return "", err
	}
	expectedExecutableSHA := hex.EncodeToString(sourceDigest.Sum(nil))
	backendPath := filepath.Join(directory, "ordax-creator-physical-test.exe")
	if err := writeAtomic(backendPath, 0o700, func(out *os.File) error {
		_, copyErr := io.Copy(out, source)
		return copyErr
	}); err != nil {
		_ = source.Close()
		return "", fmt.Errorf("materializar helper interno: %w", err)
	}
	_ = source.Close()
	if err := verifyRegularFile(backendPath, expectedExecutableSHA, sourceInfo.Size()); err != nil {
		return "", fmt.Errorf("verificar helper interno: %w", err)
	}

	seedMarkerPath := filepath.Join(directory, "ordax-bootstrap-seed.raw")
	compressedSeedSHA := hashBytes(embeddedOwnerSeedGzip)
	if err := writeAtomic(seedMarkerPath, 0o600, func(out *os.File) error {
		_, writeErr := out.Write(embeddedOwnerSeedGzip)
		return writeErr
	}); err != nil {
		return "", fmt.Errorf("materializar seed incorporado: %w", err)
	}
	if err := verifyRegularFile(seedMarkerPath, compressedSeedSHA, int64(len(embeddedOwnerSeedGzip))); err != nil {
		return "", fmt.Errorf("verificar seed incorporado: %w", err)
	}

	provenancePath := filepath.Join(directory, "provenance.json")
	if err := writeAtomic(provenancePath, 0o600, func(out *os.File) error {
		_, writeErr := out.Write(embeddedOwnerProvenance)
		return writeErr
	}); err != nil {
		return "", fmt.Errorf("materializar proveniência: %w", err)
	}
	if provenance.SourceCommit == "" {
		return "", errors.New("proveniência sem commit de origem")
	}
	return directory, nil
}

func ownerPrototypeDirectory() (string, bool) {
	ownerRuntimeOnce.Do(func() {
		ownerRuntimeDir, ownerRuntimeErr = materializeOwnerRuntime()
	})
	return ownerRuntimeDir, ownerRuntimeErr == nil && ownerRuntimeDir != ""
}

func ownerPrototypePhysicalBackend() (string, bool) {
	return ownerPrototypeDirectory()
}

func ownerRequireReady() (ownerPrototypeProvenance, error) {
	provenance, err := decodeOwnerProvenance()
	if err != nil {
		return ownerPrototypeProvenance{}, err
	}
	if !provenance.PhysicalWriteAuthorizedInBinary {
		return ownerPrototypeProvenance{}, errors.New("esta build não está autorizada para gravação física")
	}
	return provenance, nil
}

func encodeOwner(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func ownerEnumerateConfirmed(token string) (windowsadapter.Target, error) {
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return windowsadapter.Target{}, err
	}
	return windowsadapter.MatchConfirmedTarget(targets, token)
}

func runOwnerStatus() error {
	provenance, err := ownerRequireReady()
	if err != nil {
		return err
	}
	return encodeOwner(struct {
		Schema                  string            `json:"$schema"`
		Mode                    string            `json:"mode"`
		RawBackendLinked        bool              `json:"raw_backend_linked"`
		PublicCreatorUnaffected bool              `json:"public_creator_unaffected"`
		Build                   ownerBuildBinding `json:"build"`
	}{
		Schema:                  "prototype-ordax.creator-physical-test-status/2",
		Mode:                    "physical-test-only",
		RawBackendLinked:        true,
		PublicCreatorUnaffected: true,
		Build:                   ownerBinding(provenance),
	})
}

func runOwnerTargets() error {
	if _, err := ownerRequireReady(); err != nil {
		return err
	}
	targets, err := windowsadapter.EnumerateRemovableTargets()
	if err != nil {
		return err
	}
	return encodeOwner(struct {
		Schema  string                  `json:"$schema"`
		Mode    string                  `json:"mode"`
		Targets []windowsadapter.Target `json:"targets"`
	}{Schema: "prototype-ordax.creator-physical-test-targets/1", Mode: "read-only", Targets: targets})
}

func decompressOwnerSeed(outputPath string, provenance ownerPrototypeProvenance) error {
	reader, err := gzip.NewReader(bytes.NewReader(embeddedOwnerSeedGzip))
	if err != nil {
		return fmt.Errorf("abrir seed comprimido: %w", err)
	}
	defer reader.Close()

	file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(outputPath)
		}
	}()
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest), reader)
	if err != nil {
		return err
	}
	if written != provenance.SeedSize {
		return fmt.Errorf("seed incorporado com tamanho inválido: esperado=%d atual=%d", provenance.SeedSize, written)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != provenance.SeedSHA256 {
		return fmt.Errorf("seed incorporado com SHA-256 inválido: esperado=%s atual=%s", provenance.SeedSHA256, actual)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func runOwnerPrepare(args []string) error {
	provenance, err := ownerRequireReady()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("prepare", flag.ContinueOnError)
	confirm := flags.String("confirm", "", "confirmation token from targets")
	seed := flags.String("seed", "", "embedded seed marker")
	out := flags.String("out", "", "new target-sized RAW image path")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *seed == "" || *out == "" || flags.NArg() != 0 {
		return errors.New("prepare requires --confirm, --seed and --out")
	}
	target, err := ownerEnumerateConfirmed(*confirm)
	if err != nil {
		return err
	}

	executable, err := os.Executable()
	if err != nil {
		return err
	}
	expectedSeedMarker := filepath.Join(filepath.Dir(executable), "ordax-bootstrap-seed.raw")
	seedAbs, err := filepath.Abs(*seed)
	if err != nil {
		return err
	}
	expectedAbs, err := filepath.Abs(expectedSeedMarker)
	if err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Clean(seedAbs), filepath.Clean(expectedAbs)) {
		return errors.New("seed marker must remain beside the standalone Creator helper")
	}
	if err := verifyRegularFile(seedAbs, hashBytes(embeddedOwnerSeedGzip), int64(len(embeddedOwnerSeedGzip))); err != nil {
		return fmt.Errorf("verify embedded seed marker: %w", err)
	}

	outDir := filepath.Dir(*out)
	rawSeedFile, err := os.CreateTemp(outDir, "ordax-authorized-seed-*.raw")
	if err != nil {
		return fmt.Errorf("reservar seed temporário: %w", err)
	}
	rawSeedPath := rawSeedFile.Name()
	_ = rawSeedFile.Close()
	_ = os.Remove(rawSeedPath)
	defer os.Remove(rawSeedPath)
	if err := decompressOwnerSeed(rawSeedPath, provenance); err != nil {
		return fmt.Errorf("materializar seed autorizado: %w", err)
	}

	prepared, err := creatorcore.PreparePhysicalStorageImage(rawSeedPath, *out, target.PhysicalDiskBytes)
	if err != nil {
		return err
	}
	image := windowsadapter.VerifiedRawImage{Path: prepared.Path, SizeBytes: prepared.SizeBytes, SHA256: prepared.SHA256}
	authorization := windowsadapter.DestructiveAuthorizationToken(target, image)
	return encodeOwner(struct {
		Schema                   string                             `json:"$schema"`
		SourceCommit             string                             `json:"source_commit"`
		CanonicalTrustSHA256     string                             `json:"canonical_trust_sha256"`
		ManifestSHA256           string                             `json:"manifest_sha256"`
		AuthorizedSeedSHA256     string                             `json:"authorized_seed_sha256"`
		Target                   windowsadapter.Target              `json:"target"`
		PreparedImage            creatorcore.PreparedPhysicalImage `json:"prepared_image"`
		DestructiveAuthorization string                             `json:"destructive_authorization"`
		Next                     string                             `json:"next"`
	}{
		Schema:                   "prototype-ordax.creator-physical-test-preparation/2",
		SourceCommit:             provenance.SourceCommit,
		CanonicalTrustSHA256:     provenance.TrustSHA256,
		ManifestSHA256:           provenance.PrototypeManifestSHA256,
		AuthorizedSeedSHA256:     provenance.SeedSHA256,
		Target:                   target,
		PreparedImage:            prepared,
		DestructiveAuthorization: authorization,
		Next:                     "standalone Creator must elevate the same build and apply the exact target, image and authorization binding",
	})
}

func validateOwnerApplySidecarPath(imagePath, sidecarPath, expectedBase string) (string, error) {
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

func writeOwnerApplyProgress(path string, progress windowsadapter.PhysicalApplyProgress) error {
	if path == "" {
		return nil
	}
	document := ownerApplyProgressDocument{
		Schema:         physicalProgressSchema,
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

func newOwnerApplyProgressReporter(path string) func(windowsadapter.PhysicalApplyProgress) {
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
		if err := writeOwnerApplyProgress(path, progress); err != nil {
			return
		}
		lastPhase = progress.Phase
		lastBytes = progress.CompletedBytes
		lastWrite = now
	}
}

func runOwnerApply(args []string) error {
	flags := flag.NewFlagSet("apply", flag.ContinueOnError)
	confirm := flags.String("confirm", "", "confirmation token from the selected target")
	imagePath := flags.String("image", "", "prepared target-sized RAW image")
	imageSHA := flags.String("sha256", "", "prepared image SHA-256")
	imageSize := flags.Int64("size", 0, "prepared image size in bytes")
	authorize := flags.String("authorize", "", "destructive authorization token emitted by prepare")
	diagnosticLog := flags.String("diagnostic-log", "", "UTF-8 error report beside the prepared image")
	progressLog := flags.String("progress-log", "", "JSON progress report beside the prepared image")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *confirm == "" || *imagePath == "" || *imageSHA == "" || *imageSize <= 0 || *authorize == "" || flags.NArg() != 0 {
		return errors.New("apply requires --confirm, --image, --sha256, --size and --authorize")
	}

	diagnosticPath, err := validateOwnerApplySidecarPath(*imagePath, *diagnosticLog, "ordax-physical-error.txt")
	if err != nil {
		return fmt.Errorf("validate diagnostic log path: %w", err)
	}
	ownerApplyDiagnosticLog = diagnosticPath
	if ownerApplyDiagnosticLog != "" {
		_ = os.Remove(ownerApplyDiagnosticLog)
	}
	progressPath, err := validateOwnerApplySidecarPath(*imagePath, *progressLog, "ordax-physical-progress.json")
	if err != nil {
		return fmt.Errorf("validate progress log path: %w", err)
	}
	if progressPath != "" {
		_ = os.Remove(progressPath)
	}

	provenance, err := ownerRequireReady()
	if err != nil {
		return err
	}
	progressReporter := newOwnerApplyProgressReporter(progressPath)
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "starting"})
	target, err := ownerEnumerateConfirmed(*confirm)
	if err != nil {
		return err
	}
	image := windowsadapter.VerifiedRawImage{Path: *imagePath, SHA256: *imageSHA, SizeBytes: *imageSize}
	request := windowsadapter.RawDiskApplyRequest{
		Target:                    target,
		ConfirmationToken:         *confirm,
		Image:                     image,
		BootstrapSeedBytes:        provenance.SeedSize,
		CanonicalTrustResolved:    true,
		DestructiveAuthorization:  *authorize,
	}
	result, err := windowsadapter.ApplyPhysicalTestWithProgress(request, progressReporter)
	if err != nil {
		return err
	}
	layout, err := creatorcore.PlanPhysicalStorage(target.PhysicalDiskBytes)
	if err != nil {
		return fmt.Errorf("rebuild authorized storage layout after raw verification: %w", err)
	}
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "formatting-data"})
	if err := windowsadapter.FormatPortableDataVolume(target, layout.DataStartLBA, layout.DataBytes); err != nil {
		return fmt.Errorf("finalize portable ORDAX-DATA volume: %w", err)
	}
	progressReporter(windowsadapter.PhysicalApplyProgress{Phase: "complete", CompletedBytes: 1, TotalBytes: 1})
	return encodeOwner(struct {
		Schema       string                             `json:"$schema"`
		Status       string                             `json:"status"`
		PortableData string                             `json:"portable_data"`
		Result       windowsadapter.PhysicalApplyResult `json:"result"`
	}{
		Schema:       "prototype-ordax.creator-physical-test-apply/2",
		Status:       "pass-readback-verified-data-formatted",
		PortableData: "ORDAX-DATA:exFAT:verified",
		Result:       result,
	})
}

func runOwnerBackendCommand(command string, args []string) error {
	switch command {
	case "status":
		if len(args) != 0 {
			return errors.New("status does not accept arguments")
		}
		return runOwnerStatus()
	case "targets":
		if len(args) != 0 {
			return errors.New("targets does not accept arguments")
		}
		return runOwnerTargets()
	case "prepare":
		return runOwnerPrepare(args)
	case "apply":
		return runOwnerApply(args)
	default:
		return errors.New("unsupported internal backend command")
	}
}

// init turns the same standalone OrdaX-Creator.exe into its hidden internal
// backend only when it is launched with one of the purpose-bound commands used
// by the GUI. Normal launches continue into main() and show the Creator UI.
func init() {
	if len(os.Args) < 2 {
		return
	}
	command := strings.ToLower(strings.TrimSpace(os.Args[1]))
	if command != "status" && command != "targets" && command != "prepare" && command != "apply" {
		return
	}
	if err := runOwnerBackendCommand(command, os.Args[2:]); err != nil {
		if ownerApplyDiagnosticLog != "" {
			_ = os.WriteFile(ownerApplyDiagnosticLog, []byte(err.Error()+"\n"), 0o600)
		}
		_, _ = fmt.Fprintln(os.Stderr, "ordax-creator-standalone:", err)
		os.Exit(1)
	}
	os.Exit(0)
}

var _ = strconv.IntSize
