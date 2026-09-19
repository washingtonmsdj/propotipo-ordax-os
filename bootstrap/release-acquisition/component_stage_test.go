package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func componentPackageBytes(t *testing.T, sourceCommit, version string) []byte {
	t.Helper()
	runtimePath := "system/components/internet/runtime.mjs"
	runtimeBytes := []byte("export const componentRuntime = { componentId: \"internet\", version: \"" + version + "\" };\n")
	digest := sha256.Sum256(runtimeBytes)
	manifest := ComponentPackageManifest{
		Schema:       componentPackageSchema,
		Status:       "candidate",
		SourceCommit: sourceCommit,
		Entrypoint:   runtimePath,
		Component: ComponentPackageIdentity{
			ID: "internet", Title: "Internet", Kind: "app", Version: version,
			ReleaseMode: "bundled", Criticality: "optional", FailureDomain: "app",
			RestartScope: "component", HealthMode: "runtime",
			Owner: "runtime-component-test/internet", Dependencies: []string{"surface-shell"},
		},
		SelfContainedSourceGraph:          true,
		RemoteRuntimeDependencies:         false,
		ActivationAllowed:                 false,
		SignatureRequiredBeforeActivation: true,
		NativeAdaptersPackaged:            false,
		CompositionPackaged:               false,
		Files: []ComponentPackageFile{{
			Path: runtimePath, SHA256: hex.EncodeToString(digest[:]), Size: int64(len(runtimeBytes)),
		}},
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	manifestBytes = append(manifestBytes, '\n')

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, item := range []struct {
		name string
		body []byte
	}{
		{"component-package.json", manifestBytes},
		{runtimePath, runtimeBytes},
	} {
		header := &zip.FileHeader{Name: item.name, Method: zip.Store}
		header.SetMode(0o644)
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(item.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func componentReleaseFor(url string, packageBytes []byte, version string, sequence int64, sourceCommit string) ComponentReleaseManifest {
	digest := sha256.Sum256(packageBytes)
	return ComponentReleaseManifest{
		Schema:              componentReleaseSchema,
		SourceRepository:    defaultRepo,
		SourceCommit:        sourceCommit,
		ComponentID:         "internet",
		Version:             version,
		ReleaseSequence:     sequence,
		CreatedFromCIRecipe: "runtime-component/internet/1",
		Package: ComponentPackageBinding{
			Name: "internet.zip", URL: url,
			SHA256: hex.EncodeToString(digest[:]), Size: int64(len(packageBytes)),
		},
	}
}

func signedComponentEnvelope(t *testing.T, manifest ComponentReleaseManifest, keyID string, private ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	payload = append(payload, '\n')
	envelope := Envelope{
		Schema: componentEnvelopeSchema, Payload: payload,
		Signature: ed25519.Sign(private, payload), KeyID: keyID,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestStageComponentMaterializesWithoutActivationAndIsIdempotent(t *testing.T) {
	trust, public, private := testKeys(t)
	pkg := componentPackageBytes(t, testCommit, "0.3.0")
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()

	release := componentReleaseFor(server.URL+"/internet.zip", pkg, "0.3.0", 3, testCommit)
	envelope := signedComponentEnvelope(t, release, trust.KeyID, private)
	mux.HandleFunc("/envelope.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/internet.zip", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(pkg)
	})

	root := t.TempDir()
	receipt, err := stageComponent(
		server.Client(), server.URL+"/envelope.json", root,
		trust, public, defaultRepo, "internet",
	)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Idempotent || receipt.ActivationAllowed || receipt.Version != "0.3.0" {
		t.Fatalf("unexpected stage receipt: %#v", receipt)
	}
	target := filepath.Join(root, "internet", "versions", "0.3.0")
	if receipt.StagePath != target {
		t.Fatalf("unexpected stage path: %s", receipt.StagePath)
	}
	if _, err := os.Stat(filepath.Join(target, "system", "components", "internet", "runtime.mjs")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(root, "internet", "current")); !os.IsNotExist(err) {
		t.Fatalf("stage unexpectedly activated a current pointer: %v", err)
	}
	if err := verifyStagedComponent(target, release, mustComponentPayload(t, envelope), envelope); err != nil {
		t.Fatal(err)
	}

	second, err := stageComponent(
		server.Client(), server.URL+"/envelope.json", root,
		trust, public, defaultRepo, "internet",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Idempotent || second.ActivationAllowed {
		t.Fatalf("repeated stage was not idempotent/fail-closed: %#v", second)
	}
}

func mustComponentPayload(t *testing.T, envelopeBytes []byte) []byte {
	t.Helper()
	var envelope Envelope
	if err := json.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Payload
}

func TestStageComponentRejectsTamperedPackage(t *testing.T) {
	trust, public, private := testKeys(t)
	pkg := componentPackageBytes(t, testCommit, "0.3.0")
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	release := componentReleaseFor(server.URL+"/internet.zip", pkg, "0.3.0", 3, testCommit)
	envelope := signedComponentEnvelope(t, release, trust.KeyID, private)
	mux.HandleFunc("/envelope.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/internet.zip", func(w http.ResponseWriter, r *http.Request) {
		tampered := append([]byte(nil), pkg...)
		tampered[len(tampered)-1] ^= 1
		_, _ = w.Write(tampered)
	})

	root := t.TempDir()
	if _, err := stageComponent(
		server.Client(), server.URL+"/envelope.json", root,
		trust, public, defaultRepo, "internet",
	); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("tampered package error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "internet", "versions", "0.3.0")); !os.IsNotExist(err) {
		t.Fatalf("tampered component version appeared: %v", err)
	}
}

func TestStageComponentRejectsRollbackAndReusedSequence(t *testing.T) {
	trust, public, private := testKeys(t)
	root := t.TempDir()

	stageOne := func(version string, sequence int64, commit string) error {
		pkg := componentPackageBytes(t, commit, version)
		mux := http.NewServeMux()
		server := httptest.NewTLSServer(mux)
		defer server.Close()
		release := componentReleaseFor(server.URL+"/internet.zip", pkg, version, sequence, commit)
		envelope := signedComponentEnvelope(t, release, trust.KeyID, private)
		mux.HandleFunc("/envelope.json", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write(envelope)
		})
		mux.HandleFunc("/internet.zip", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write(pkg)
		})
		_, err := stageComponent(
			server.Client(), server.URL+"/envelope.json", root,
			trust, public, defaultRepo, "internet",
		)
		return err
	}

	if err := stageOne("0.3.0", 3, testCommit); err != nil {
		t.Fatal(err)
	}
	if err := stageOne("0.2.0", 2, "1111111111111111111111111111111111111111"); err == nil || !strings.Contains(err.Error(), "rollback rejected") {
		t.Fatalf("rollback error = %v", err)
	}
	if err := stageOne("0.4.0", 3, "2222222222222222222222222222222222222222"); err == nil || !strings.Contains(err.Error(), "reused") {
		t.Fatalf("reused sequence error = %v", err)
	}
}

func TestStageComponentCleansInterruptedStagingResidue(t *testing.T) {
	trust, public, private := testKeys(t)
	root := t.TempDir()
	versions := filepath.Join(root, "internet", "versions")
	if err := os.MkdirAll(filepath.Join(versions, ".staging-dead-power-loss"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(versions, ".staging-dead-power-loss", "partial"), []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}

	pkg := componentPackageBytes(t, testCommit, "0.3.0")
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	release := componentReleaseFor(server.URL+"/internet.zip", pkg, "0.3.0", 3, testCommit)
	envelope := signedComponentEnvelope(t, release, trust.KeyID, private)
	mux.HandleFunc("/envelope.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/internet.zip", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(pkg)
	})

	if _, err := stageComponent(
		server.Client(), server.URL+"/envelope.json", root,
		trust, public, defaultRepo, "internet",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(versions, ".staging-dead-power-loss")); !os.IsNotExist(err) {
		t.Fatalf("stale staging directory survived recovery: %v", err)
	}
}

func TestVerifyComponentEnvelopeRejectsTamperAndWrongComponent(t *testing.T) {
	trust, public, private := testKeys(t)
	pkg := componentPackageBytes(t, testCommit, "0.3.0")
	release := componentReleaseFor("https://example.invalid/internet.zip", pkg, "0.3.0", 3, testCommit)
	envelope := signedComponentEnvelope(t, release, trust.KeyID, private)

	if _, _, err := verifyComponentEnvelope(envelope, trust, public, defaultRepo, "notes"); err == nil || !strings.Contains(err.Error(), "id mismatch") {
		t.Fatalf("wrong component error = %v", err)
	}

	var decoded Envelope
	if err := json.Unmarshal(envelope, &decoded); err != nil {
		t.Fatal(err)
	}
	decoded.Payload = append([]byte(nil), decoded.Payload...)
	decoded.Payload[0] ^= 1
	tampered, _ := json.Marshal(decoded)
	if _, _, err := verifyComponentEnvelope(tampered, trust, public, defaultRepo, "internet"); err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered envelope error = %v", err)
	}
}
