//go:build windows

package trust

import (
	"os"
	"path/filepath"
	"testing"
)

func testPaths(t *testing.T) Paths {
	t.Helper()
	root := t.TempDir()
	secret := filepath.Join(root, "secret")
	review := filepath.Join(root, "review")
	if err := os.MkdirAll(secret, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(review, 0o700); err != nil {
		t.Fatal(err)
	}
	return Paths{
		SecretDirectory: secret,
		ReviewDirectory: review,
		ProtectedKey:    filepath.Join(secret, "private.dpapi"),
		PublicTrust:     filepath.Join(review, "release-ed25519.json"),
		State:           filepath.Join(review, "local-trust-state.json"),
	}
}

func TestInitializeCreatesDPAPIProtectedIdentityAndIsIdempotent(t *testing.T) {
	paths := testPaths(t)
	first, err := initialize(paths)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Configured || !first.Valid || !first.PrivateKeyProtected || !first.ProofVerified {
		t.Fatalf("unexpected trust snapshot: %+v", first)
	}
	if first.PrivateKeyProtection != "windows-dpapi-current-user" {
		t.Fatalf("protection = %q", first.PrivateKeyProtection)
	}
	if !first.OfflineBackupRequired || first.ReadyToPinPublicAnchor {
		t.Fatalf("unexpected backup gate: %+v", first)
	}
	protected, err := os.ReadFile(paths.ProtectedKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(protected) == 0 {
		t.Fatal("protected key was not persisted")
	}

	second, err := initialize(paths)
	if err != nil {
		t.Fatal(err)
	}
	if first.PublicTrustSHA256 != second.PublicTrustSHA256 {
		t.Fatal("idempotent initialization changed the public identity")
	}
}

func TestInspectRejectsTamperedPublicAnchor(t *testing.T) {
	paths := testPaths(t)
	if _, err := initialize(paths); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(paths.PublicTrust)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err := os.WriteFile(paths.PublicTrust, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspect(paths); err == nil {
		t.Fatal("tampered public trust anchor unexpectedly accepted")
	}
}

func TestInitializeRefusesPartialExistingIdentity(t *testing.T) {
	paths := testPaths(t)
	if err := os.WriteFile(paths.PublicTrust, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := initialize(paths); err == nil {
		t.Fatal("partial trust identity unexpectedly overwritten")
	}
}
