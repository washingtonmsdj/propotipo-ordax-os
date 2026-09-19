package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validRuntimeComponentManifestBytes() []byte {
	return []byte(`{
  "$schema": "prototype-ordax.runtime-component-release-manifest/1",
  "purpose": "ordax-runtime-component",
  "source_repository": "washingtonmsdj/prototipo-ordax-os",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "component_id": "internet",
  "version": "0.3.0",
  "release_sequence": 1,
  "created_from_recipe": "runtime/component/package/1",
  "package": {
    "name": "internet.zip",
    "url": "https://github.com/washingtonmsdj/prototipo-ordax-os/releases/download/runtime-components/internet.zip",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "size": 1234
  }
}
`)
}

func writeRuntimeManifestForTest(t *testing.T, root string, data []byte) string {
	t.Helper()
	path := filepath.Join(root, "runtime-component-manifest.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRuntimeComponentSignAndVerifyRoundTrip(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestBytes := validRuntimeComponentManifestBytes()
	manifestPath := writeRuntimeManifestForTest(t, root, manifestBytes)
	envelopePath := filepath.Join(root, "component-envelope.json")

	signed, err := signRuntimeComponentManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
	)
	if err != nil {
		t.Fatal(err)
	}
	if signed.ComponentID != "internet" || signed.Version != "0.3.0" || signed.ReleaseSequence != 1 {
		t.Fatalf("unexpected signed manifest: %#v", signed)
	}

	var envelope Envelope
	envelopeBytes, err := os.ReadFile(envelopePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Schema != runtimeComponentEnvelopeSchema {
		t.Fatalf("unexpected envelope schema: %q", envelope.Schema)
	}
	if string(envelope.Payload) != string(manifestBytes) {
		t.Fatal("runtime component signing changed exact manifest bytes")
	}

	verified, err := verifyRuntimeComponentEnvelope(envelopePath, trustPath, defaultRepo)
	if err != nil {
		t.Fatal(err)
	}
	if verified != signed {
		t.Fatalf("verified manifest differs: got=%#v want=%#v", verified, signed)
	}
}

func TestRuntimeComponentEnvelopeRejectsTamper(t *testing.T) {
	root := t.TempDir()
	privatePath := filepath.Join(root, "private.pem")
	trustPath := filepath.Join(root, "trust.json")
	if _, err := generateKeyFiles(privatePath, trustPath, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeRuntimeManifestForTest(t, root, validRuntimeComponentManifestBytes())
	envelopePath := filepath.Join(root, "component-envelope.json")
	if _, err := signRuntimeComponentManifest(
		manifestPath,
		privatePath,
		trustPath,
		envelopePath,
		"prototype-1",
		defaultRepo,
	); err != nil {
		t.Fatal(err)
	}

	var envelope Envelope
	data, _ := os.ReadFile(envelopePath)
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.Payload = append([]byte(nil), envelope.Payload...)
	envelope.Payload[len(envelope.Payload)-2] ^= 1
	tampered, err := marshalJSON(envelope)
	if err != nil {
		t.Fatal(err)
	}
	tamperedPath := filepath.Join(root, "tampered.json")
	if err := os.WriteFile(tamperedPath, tampered, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyRuntimeComponentEnvelope(tamperedPath, trustPath, defaultRepo); err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("tampered runtime component envelope error=%v", err)
	}
}

func TestRuntimeComponentManifestRejectsUnsafeIdentityAndChannel(t *testing.T) {
	var manifest RuntimeComponentManifest
	if err := json.Unmarshal(validRuntimeComponentManifestBytes(), &manifest); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		edit func(*RuntimeComponentManifest)
		want string
	}{
		{
			name: "zero sequence",
			edit: func(value *RuntimeComponentManifest) { value.ReleaseSequence = 0 },
			want: "release_sequence",
		},
		{
			name: "invalid version",
			edit: func(value *RuntimeComponentManifest) { value.Version = "version-three" },
			want: "version",
		},
		{
			name: "wrong package name",
			edit: func(value *RuntimeComponentManifest) { value.Package.Name = "other.zip" },
			want: "package name",
		},
		{
			name: "http package",
			edit: func(value *RuntimeComponentManifest) { value.Package.URL = "http://example.invalid/internet.zip" },
			want: "absolute HTTPS",
		},
		{
			name: "wrong package basename",
			edit: func(value *RuntimeComponentManifest) { value.Package.URL = "https://example.invalid/other.zip" },
			want: "must end with",
		},
		{
			name: "oversize package",
			edit: func(value *RuntimeComponentManifest) { value.Package.Size = maxRuntimeComponentPackage + 1 },
			want: "size",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := manifest
			tc.edit(&copy)
			data, _ := json.Marshal(copy)
			if _, err := strictRuntimeComponentManifest(data, defaultRepo); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error=%v want substring %q", err, tc.want)
			}
		})
	}
}

func TestRuntimeComponentManifestRejectsUnknownFieldsAndTrustMismatch(t *testing.T) {
	unknown := []byte(`{
	  "$schema":"prototype-ordax.runtime-component-release-manifest/1",
	  "purpose":"ordax-runtime-component",
	  "source_repository":"washingtonmsdj/prototipo-ordax-os",
	  "source_commit":"0123456789abcdef0123456789abcdef01234567",
	  "component_id":"internet",
	  "version":"0.3.0",
	  "release_sequence":1,
	  "created_from_recipe":"runtime/component/package/1",
	  "package":{"name":"internet.zip","url":"https://example.invalid/internet.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1},
	  "unexpected":true
	}`)
	if _, err := strictRuntimeComponentManifest(unknown, defaultRepo); err == nil {
		t.Fatal("runtime component manifest with unknown field was accepted")
	}

	root := t.TempDir()
	privateA := filepath.Join(root, "a.pem")
	trustA := filepath.Join(root, "a.json")
	privateB := filepath.Join(root, "b.pem")
	trustB := filepath.Join(root, "b.json")
	if _, err := generateKeyFiles(privateA, trustA, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := generateKeyFiles(privateB, trustB, "prototype-1"); err != nil {
		t.Fatal(err)
	}
	manifestPath := writeRuntimeManifestForTest(t, root, validRuntimeComponentManifestBytes())
	output := filepath.Join(root, "component-envelope.json")
	if _, err := signRuntimeComponentManifest(
		manifestPath,
		privateA,
		trustB,
		output,
		"prototype-1",
		defaultRepo,
	); err == nil || !strings.Contains(err.Error(), "does not match supplied trust anchor") {
		t.Fatalf("private/trust mismatch error=%v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("envelope appeared after trust mismatch: %v", err)
	}
}
