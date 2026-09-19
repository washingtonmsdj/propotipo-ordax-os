package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testSourceCommit = "0123456789abcdef0123456789abcdef01234567"

type testFixture struct {
	dir          string
	packagePath  string
	releasePath  string
	privatePath  string
	trustPath    string
	envelopePath string
	release      releaseDescriptor
}

func writeZipEntry(t *testing.T, writer *zip.Writer, name string, payload []byte) {
	t.Helper()
	header := &zip.FileHeader{Name: name, Method: zip.Store}
	header.SetMode(0o644)
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(payload); err != nil {
		t.Fatal(err)
	}
}

func packageManifestFor(t *testing.T, runtimePath string, runtimeBytes []byte, sourceCommit string) ([]byte, componentPackageManifest) {
	t.Helper()
	runtimeDigest := sha256.Sum256(runtimeBytes)
	manifest := componentPackageManifest{
		Schema: packageSchema,
		Status: "candidate",
		Component: packageComponent{
			ID:            "internet",
			Title:         "Internet",
			Kind:          "app",
			Version:       "0.3.0",
			ReleaseMode:   "bundled",
			Criticality:   "optional",
			FailureDomain: "app",
			RestartScope:  "component",
			HealthMode:    "runtime",
			Owner:         "system/apps/internet",
			Dependencies:  []string{"surface-shell"},
		},
		SourceCommit:                      sourceCommit,
		Entrypoint:                        runtimePath,
		SelfContainedSourceGraph:          true,
		RemoteRuntimeDependencies:         false,
		ActivationAllowed:                 false,
		SignatureRequiredBeforeActivation: true,
		NativeAdaptersPackaged:            false,
		CompositionPackaged:               false,
		Files: []packageFile{
			{
				Path:   runtimePath,
				SHA256: hex.EncodeToString(runtimeDigest[:]),
				Size:   int64(len(runtimeBytes)),
			},
		},
	}
	payload, err := marshalJSON(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return payload, manifest
}

func writePackage(t *testing.T, directory, runtimePath string) (string, string, string, int64) {
	t.Helper()
	packagePath := filepath.Join(directory, "internet.zip")
	runtimeBytes := []byte("export const componentRuntime = { schema: \"ordax.component-runtime/1\" };\n")
	manifestBytes, _ := packageManifestFor(t, runtimePath, runtimeBytes, testSourceCommit)

	file, err := os.OpenFile(packagePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	writeZipEntry(t, writer, packageManifestName, manifestBytes)
	writeZipEntry(t, writer, runtimePath, runtimeBytes)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	manifestDigest := sha256.Sum256(manifestBytes)
	packageHash, packageSize, err := sha256File(packagePath, maxPackageBytes)
	if err != nil {
		t.Fatal(err)
	}
	return packagePath, hex.EncodeToString(manifestDigest[:]), packageHash, packageSize
}

func writeRelease(t *testing.T, directory string, packagePath string, manifestHash string, packageHash string, packageSize int64) (string, releaseDescriptor) {
	t.Helper()
	release := releaseDescriptor{
		Schema:            releaseSchema,
		SourceRepository:  sourceRepository,
		SourceCommit:      testSourceCommit,
		CreatedFromRecipe: createdFromRecipe,
		Component: releaseComponent{
			ID:            "internet",
			Version:       "0.3.0",
			ReleaseMode:   "bundled",
			PackageSchema: packageSchema,
		},
		Package: packageBinding{
			Name:           filepath.Base(packagePath),
			SHA256:         packageHash,
			Size:           packageSize,
			ManifestSHA256: manifestHash,
		},
		Activation: activationPolicy{
			DirectActivationAllowed: false,
			PendingHealthRequired:    true,
		},
	}
	payload, err := marshalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "runtime-component-release.json")
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	return path, release
}

func makeFixture(t *testing.T) testFixture {
	t.Helper()
	dir := t.TempDir()
	packagePath, manifestHash, packageHash, packageSize := writePackage(
		t,
		dir,
		"system/components/internet/runtime.mjs",
	)
	releasePath, release := writeRelease(
		t,
		dir,
		packagePath,
		manifestHash,
		packageHash,
		packageSize,
	)
	privatePath := filepath.Join(dir, "component-private.pem")
	trustPath := filepath.Join(dir, "component-trust.json")
	if _, err := generateKey(privatePath, trustPath, "runtime-components-test-1"); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(dir, "runtime-component-envelope.json")
	if _, err := signRelease(
		releasePath,
		privatePath,
		trustPath,
		envelopePath,
		"runtime-components-test-1",
	); err != nil {
		t.Fatal(err)
	}
	return testFixture{
		dir:          dir,
		packagePath:  packagePath,
		releasePath:  releasePath,
		privatePath:  privatePath,
		trustPath:    trustPath,
		envelopePath: envelopePath,
		release:      release,
	}
}

func TestSigningUsesSeparateRuntimeComponentTrustDomain(t *testing.T) {
	fixture := makeFixture(t)
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	var trust trustAnchor
	if err := json.Unmarshal(trustBytes, &trust); err != nil {
		t.Fatal(err)
	}
	if trust.Schema != trustSchema {
		t.Fatalf("trust schema = %q", trust.Schema)
	}
	if trust.Schema == "prototype-ordax.release-trust/1" {
		t.Fatal("runtime component trust unexpectedly aliases whole-OS release trust")
	}

	envelopeBytes, err := os.ReadFile(fixture.envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	release, err := verifyEnvelopeBytes(envelopeBytes, trustBytes)
	if err != nil {
		t.Fatal(err)
	}
	if release.Component.ID != "internet" || release.Component.Version != "0.3.0" {
		t.Fatalf("unexpected component identity: %+v", release.Component)
	}
	if release.Activation.DirectActivationAllowed || !release.Activation.PendingHealthRequired {
		t.Fatalf("unsafe activation policy: %+v", release.Activation)
	}
}

func TestStageCreatesImmutableVerifiedSlotWithoutActivation(t *testing.T) {
	fixture := makeFixture(t)
	root := filepath.Join(fixture.dir, "slots")
	release, slot, changed, err := stageComponent(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("first stage did not create a slot")
	}
	expectedSuffix := filepath.Join(
		"internet",
		"versions",
		"0.3.0",
		testSourceCommit,
	)
	if !strings.HasSuffix(slot, expectedSuffix) {
		t.Fatalf("slot = %q", slot)
	}
	if release.Component.ReleaseMode != "bundled" {
		t.Fatalf("release mode changed prematurely: %s", release.Component.ReleaseMode)
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifySlotWithTrustBytes(slot, trustBytes); err != nil {
		t.Fatal(err)
	}

	runtimePath := filepath.Join(slot, "system", "components", "internet", "runtime.mjs")
	info, err := os.Stat(runtimePath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o222 != 0 {
		t.Fatalf("staged runtime remains writable: %04o", info.Mode().Perm())
	}

	_, sameSlot, changed, err := stageComponent(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if changed || sameSlot != slot {
		t.Fatalf("restage should reuse verified immutable slot: changed=%t slot=%q", changed, sameSlot)
	}
}

func TestTamperedPackageIsRejectedBeforeStaging(t *testing.T) {
	fixture := makeFixture(t)
	file, err := os.OpenFile(fixture.packagePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("tampered")); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	_, _, _, err = stageComponent(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		filepath.Join(fixture.dir, "slots"),
	)
	if err == nil || !strings.Contains(err.Error(), "SHA-256/size") {
		t.Fatalf("tampered package error = %v", err)
	}
}

func TestTamperedEnvelopeIsRejected(t *testing.T) {
	fixture := makeFixture(t)
	envelopeBytes, err := os.ReadFile(fixture.envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	var signed envelope
	if err := json.Unmarshal(envelopeBytes, &signed); err != nil {
		t.Fatal(err)
	}
	signed.Payload[0] ^= 1
	tamperedBytes, err := marshalJSON(signed)
	if err != nil {
		t.Fatal(err)
	}
	tamperedPath := filepath.Join(fixture.dir, "tampered-envelope.json")
	if err := os.WriteFile(tamperedPath, tamperedBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, _, err = verifyEnvelopeFiles(tamperedPath, fixture.trustPath)
	if err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered envelope error = %v", err)
	}
}

func TestWrongRuntimeComponentTrustIsRejected(t *testing.T) {
	fixture := makeFixture(t)
	otherPrivate := filepath.Join(fixture.dir, "other-private.pem")
	otherTrust := filepath.Join(fixture.dir, "other-trust.json")
	if _, err := generateKey(otherPrivate, otherTrust, "runtime-components-test-1"); err != nil {
		t.Fatal(err)
	}
	_, _, _, err := verifyEnvelopeFiles(fixture.envelopePath, otherTrust)
	if err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("wrong trust error = %v", err)
	}
}

func TestSignedTraversalPackageIsStillRejected(t *testing.T) {
	dir := t.TempDir()
	packagePath, manifestHash, packageHash, packageSize := writePackage(t, dir, "../escape.mjs")
	releasePath, _ := writeRelease(t, dir, packagePath, manifestHash, packageHash, packageSize)
	privatePath := filepath.Join(dir, "private.pem")
	trustPath := filepath.Join(dir, "trust.json")
	if _, err := generateKey(privatePath, trustPath, "runtime-components-test-1"); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(dir, "envelope.json")
	if _, err := signRelease(releasePath, privatePath, trustPath, envelopePath, "runtime-components-test-1"); err != nil {
		t.Fatal(err)
	}
	_, _, _, err := stageComponent(
		envelopePath,
		trustPath,
		packagePath,
		filepath.Join(dir, "slots"),
	)
	if err == nil || !strings.Contains(err.Error(), "unsafe component package path") {
		t.Fatalf("traversal package error = %v", err)
	}
}

func TestInstalledSlotTamperingIsDetected(t *testing.T) {
	fixture := makeFixture(t)
	root := filepath.Join(fixture.dir, "slots")
	_, slot, _, err := stageComponent(
		fixture.envelopePath,
		fixture.trustPath,
		fixture.packagePath,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(slot, "system", "components", "internet", "runtime.mjs")
	if runtime.GOOS != "windows" {
		if err := os.Chmod(runtimePath, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(runtimePath, []byte("tampered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	trustBytes, err := os.ReadFile(fixture.trustPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifySlotWithTrustBytes(slot, trustBytes)
	if err == nil {
		t.Fatal("tampered installed slot unexpectedly verified")
	}
	if !strings.Contains(err.Error(), "writable") && !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("unexpected slot tamper error: %v", err)
	}
}

func TestReleaseDescriptorRejectsDirectActivation(t *testing.T) {
	fixture := makeFixture(t)
	release := fixture.release
	release.Activation.DirectActivationAllowed = true
	if err := validateReleaseDescriptor(release); err == nil {
		t.Fatal("direct activation was accepted")
	}
}
