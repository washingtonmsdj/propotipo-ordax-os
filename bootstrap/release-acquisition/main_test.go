package main

import (
	"archive/tar"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testCommit = "0123456789abcdef0123456789abcdef01234567"

type archiveEntry struct {
	name     string
	mode     int64
	typeflag byte
	body     []byte
	linkname string
}

func makeSystemTar(t *testing.T, entries ...archiveEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for _, entry := range entries {
		header := &tar.Header{
			Name:     entry.name,
			Mode:     entry.mode,
			Typeflag: entry.typeflag,
			Size:     int64(len(entry.body)),
			Linkname: entry.linkname,
		}
		if entry.typeflag == tar.TypeDir || entry.typeflag == tar.TypeSymlink || entry.typeflag == tar.TypeLink {
			header.Size = 0
		}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := writer.Write(entry.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func validSystemTar(t *testing.T) []byte {
	t.Helper()
	return makeSystemTar(t,
		archiveEntry{name: "system/", mode: 0o755, typeflag: tar.TypeDir},
		archiveEntry{name: "system/entrypoint", mode: 0o755, typeflag: tar.TypeReg, body: []byte("#!/bin/sh\necho ordax-test\n")},
		archiveEntry{name: "system/version", mode: 0o644, typeflag: tar.TypeReg, body: []byte("prototype-test\n")},
	)
}

func writeTempArchive(t *testing.T, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "system.tar")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func testKeys(t *testing.T) (TrustAnchor, ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	trust := TrustAnchor{
		Schema:       trustSchema,
		KeyID:        "prototype-1",
		PublicKeyB64: base64.StdEncoding.EncodeToString(pub),
	}
	return trust, pub, priv
}

func signedEnvelope(t *testing.T, manifest Manifest, keyID string, priv ed25519.PrivateKey) []byte {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		Schema:    envelopeSchema,
		Payload:   payload,
		Signature: ed25519.Sign(priv, payload),
		KeyID:     keyID,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func manifestFor(rawURL string, data []byte) Manifest {
	digest := sha256.Sum256(data)
	return Manifest{
		Schema:              manifestSchema,
		SourceRepository:    defaultRepo,
		SourceCommit:        testCommit,
		ReleaseID:           testCommit,
		CreatedFromCIRecipe: "release-agent-test/1",
		Artifacts: []Artifact{{
			Name:   "system.tar",
			Role:   "system",
			URL:    rawURL,
			SHA256: hex.EncodeToString(digest[:]),
			Size:   int64(len(data)),
		}},
	}
}

func TestVerifyEnvelopeAcceptsExactSignedPayload(t *testing.T) {
	trust, pub, priv := testKeys(t)
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	data := signedEnvelope(t, m, trust.KeyID, priv)
	got, payload, err := verifyEnvelope(data, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if got.SourceCommit != testCommit || len(payload) == 0 {
		t.Fatalf("unexpected verified manifest: %#v", got)
	}
}

func TestVerifyEnvelopeRejectsTamperedPayload(t *testing.T) {
	trust, pub, priv := testKeys(t)
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	data := signedEnvelope(t, m, trust.KeyID, priv)
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload[0] ^= 1
	data, _ = json.Marshal(envelope)
	if _, _, err := verifyEnvelope(data, trust, pub, defaultRepo); err == nil {
		t.Fatal("tampered signed payload was accepted")
	}
}

func TestManifestRejectsNonHTTPSArtifact(t *testing.T) {
	m := manifestFor("http://example.invalid/system.tar", []byte("payload"))
	if err := validateManifest(m, defaultRepo); err == nil {
		t.Fatal("HTTP artifact URL was accepted")
	}
}

func TestManifestRequiresExactlyOneCanonicalSystemTar(t *testing.T) {
	m := manifestFor("https://example.invalid/system.tar", []byte("payload"))
	m.Artifacts[0].Name = "other.tar"
	if err := validateManifest(m, defaultRepo); err == nil {
		t.Fatal("non-canonical release artifact was accepted")
	}
	m = manifestFor("https://example.invalid/system.tar", []byte("payload"))
	m.Artifacts = append(m.Artifacts, m.Artifacts[0])
	if err := validateManifest(m, defaultRepo); err == nil {
		t.Fatal("multiple v1 release artifacts were accepted")
	}
	m = manifestFor("https://example.invalid/system.tar", []byte("payload"))
	if err := validateManifest(m, "someone/else"); err == nil {
		t.Fatal("repository mismatch was accepted")
	}
}

func TestExtractSystemArchiveRejectsTraversal(t *testing.T) {
	archive := makeSystemTar(t,
		archiveEntry{name: "system/", mode: 0o755, typeflag: tar.TypeDir},
		archiveEntry{name: "system/../escape", mode: 0o644, typeflag: tar.TypeReg, body: []byte("escape")},
		archiveEntry{name: "system/entrypoint", mode: 0o755, typeflag: tar.TypeReg, body: []byte("#!/bin/sh\n")},
	)
	root := t.TempDir()
	if err := extractSystemArchive(writeTempArchive(t, archive), root); err == nil {
		t.Fatal("path traversal archive was accepted")
	}
	if _, err := os.Stat(filepath.Join(root, "escape")); !os.IsNotExist(err) {
		t.Fatal("path traversal wrote outside system root")
	}
}

func TestExtractSystemArchiveRejectsSymlink(t *testing.T) {
	archive := makeSystemTar(t,
		archiveEntry{name: "system/", mode: 0o755, typeflag: tar.TypeDir},
		archiveEntry{name: "system/entrypoint", mode: 0o755, typeflag: tar.TypeReg, body: []byte("#!/bin/sh\n")},
		archiveEntry{name: "system/link", mode: 0o777, typeflag: tar.TypeSymlink, linkname: "/etc/passwd"},
	)
	if err := extractSystemArchive(writeTempArchive(t, archive), t.TempDir()); err == nil {
		t.Fatal("symlink archive entry was accepted")
	}
}

func TestExtractSystemArchiveRequiresBootableEntrypoint(t *testing.T) {
	archive := makeSystemTar(t,
		archiveEntry{name: "system/", mode: 0o755, typeflag: tar.TypeDir},
		archiveEntry{name: "system/version", mode: 0o644, typeflag: tar.TypeReg, body: []byte("no-entrypoint\n")},
	)
	if err := extractSystemArchive(writeTempArchive(t, archive), t.TempDir()); err == nil {
		t.Fatal("archive without system/entrypoint was accepted")
	}
}

func TestInstallMaterializesBootableVerifiedRelease(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := validSystemTar(t)
	var envelope []byte
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope = signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(artifact)
	})
	root := t.TempDir()
	receipt, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Idempotent || receipt.SourceCommit != testCommit {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", testCommit) {
		t.Fatalf("unexpected current target: %s", current)
	}
	target := filepath.Join(root, "releases", testCommit)
	entrypoint := filepath.Join(target, "system", "entrypoint")
	entrypointInfo, err := os.Stat(entrypoint)
	if err != nil {
		t.Fatal(err)
	}
	if entrypointInfo.Mode().Perm() != 0o755 || entrypointInfo.Size() == 0 {
		t.Fatal("materialized entrypoint is not bootable")
	}
	archived, err := os.ReadFile(filepath.Join(target, "artifacts", "system.tar"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(archived, artifact) {
		t.Fatal("preserved release artifact differs from verified system.tar")
	}
	version, err := os.ReadFile(filepath.Join(target, "system", "version"))
	if err != nil {
		t.Fatal(err)
	}
	if string(version) != "prototype-test\n" {
		t.Fatal("materialized system tree differs from archive")
	}
	second, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Idempotent {
		t.Fatal("reinstall of identical release was not idempotent")
	}
}

func TestMaterializeDoesNotActivateCurrent(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := validSystemTar(t)
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope := signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(artifact)
	})

	root := t.TempDir()
	old := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := os.MkdirAll(filepath.Join(root, "releases", old), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("releases", old), filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}

	receipt, err := materialize(
		server.Client(),
		server.URL+"/release.json",
		root,
		trust,
		pub,
		defaultRepo,
		testCommit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != "materialized" || receipt.SourceCommit != testCommit || receipt.Idempotent {
		t.Fatalf("unexpected materialize receipt: %#v", receipt)
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", old) {
		t.Fatalf("materialize changed current pointer: %s", current)
	}
	target := filepath.Join(root, "releases", testCommit)
	if _, err := os.Stat(filepath.Join(target, "system", "entrypoint")); err != nil {
		t.Fatalf("verified release was not materialized: %v", err)
	}
	storedEnvelope, err := os.ReadFile(filepath.Join(target, "release-envelope.json"))
	if err != nil {
		t.Fatalf("verified release envelope was not persisted: %v", err)
	}
	if !bytes.Equal(storedEnvelope, envelope) {
		t.Fatal("persisted release envelope differs from verified signed bytes")
	}
	storedManifest, err := os.ReadFile(filepath.Join(target, "release-manifest.json"))
	if err != nil {
		t.Fatalf("verified release manifest was not persisted: %v", err)
	}
	var decoded Envelope
	if err := json.Unmarshal(envelope, &decoded); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedManifest, decoded.Payload) {
		t.Fatal("persisted manifest differs from signed envelope payload")
	}

	second, err := materialize(
		server.Client(),
		server.URL+"/release.json",
		root,
		trust,
		pub,
		defaultRepo,
		testCommit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Idempotent {
		t.Fatal("second materialize was not idempotent")
	}
	current, err = os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", old) {
		t.Fatalf("idempotent materialize changed current pointer: %s", current)
	}
}

func TestMaterializeRejectsUnexpectedCommitBeforeRootMutation(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := validSystemTar(t)
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope := signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("artifact must not be requested when signed commit mismatches")
	})

	root := filepath.Join(t.TempDir(), "ordax-root")
	unexpected := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if _, err := materialize(
		server.Client(),
		server.URL+"/release.json",
		root,
		trust,
		pub,
		defaultRepo,
		unexpected,
	); err == nil {
		t.Fatal("signed release for a different commit was materialized")
	}
	if _, err := os.Lstat(root); !os.IsNotExist(err) {
		t.Fatal("commit mismatch mutated the OrdaX root")
	}
}

func TestExistingReleaseRejectsPersistedEnvelopeTampering(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := validSystemTar(t)
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope := signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(artifact)
	})
	root := t.TempDir()
	if _, err := materialize(
		server.Client(),
		server.URL+"/release.json",
		root,
		trust,
		pub,
		defaultRepo,
		testCommit,
	); err != nil {
		t.Fatal(err)
	}
	envelopePath := filepath.Join(root, "releases", testCommit, "release-envelope.json")
	persisted, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	persisted[len(persisted)/2] ^= 0x01
	if err := os.WriteFile(envelopePath, persisted, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := materialize(
		server.Client(),
		server.URL+"/release.json",
		root,
		trust,
		pub,
		defaultRepo,
		testCommit,
	); err == nil || !strings.Contains(err.Error(), "release envelope differs") {
		t.Fatalf("tampered persisted envelope was accepted: %v", err)
	}
}

func TestExistingReleaseRejectsMaterializedTreeTampering(t *testing.T) {
	trust, pub, priv := testKeys(t)
	artifact := validSystemTar(t)
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", artifact)
	envelope := signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(artifact)
	})
	root := t.TempDir()
	if _, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo); err != nil {
		t.Fatal(err)
	}
	tampered := filepath.Join(root, "releases", testCommit, "system", "version")
	if err := os.WriteFile(tampered, []byte("tampered\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo); err == nil {
		t.Fatal("tampered materialized release was accepted as idempotent")
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", testCommit) {
		t.Fatalf("current pointer changed after tamper detection: %s", current)
	}
}

func TestFailedNewReleasePreservesCurrentKnownGood(t *testing.T) {
	trust, pub, priv := testKeys(t)
	declared := validSystemTar(t)
	served := append([]byte(nil), declared...)
	served[len(served)/2] ^= 0xff
	var envelope []byte
	mux := http.NewServeMux()
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	m := manifestFor(server.URL+"/system.tar", declared)
	envelope = signedEnvelope(t, m, trust.KeyID, priv)
	mux.HandleFunc("/release.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(envelope)
	})
	mux.HandleFunc("/system.tar", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(served)
	})
	root := t.TempDir()
	old := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := os.MkdirAll(filepath.Join(root, "releases", old), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("releases", old), filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}
	if _, err := install(server.Client(), server.URL+"/release.json", root, trust, pub, defaultRepo); err == nil {
		t.Fatal("corrupt release was installed")
	}
	current, err := os.Readlink(filepath.Join(root, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if current != filepath.Join("releases", old) {
		t.Fatalf("known-good current changed after failed update: %s", current)
	}
	if _, err := os.Stat(filepath.Join(root, "releases", testCommit)); !os.IsNotExist(err) {
		t.Fatal("failed release target survived verification failure")
	}
}

func TestLoadTrustRejectsSymlink(t *testing.T) {
	trust, _, _ := testKeys(t)
	data, _ := json.Marshal(trust)
	dir := t.TempDir()
	real := filepath.Join(dir, "trust.json")
	link := filepath.Join(dir, "trust-link.json")
	if err := os.WriteFile(real, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadTrust(link); err == nil {
		t.Fatal("symlink trust anchor was accepted")
	}
}
