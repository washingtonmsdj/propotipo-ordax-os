package trust

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	AnchorSchema   = "prototype-ordax.release-trust/1"
	StateSchema    = "prototype-ordax.creator-local-trust-state/1"
	SnapshotSchema = "prototype-ordax.creator-trust-status/1"
	KeyID          = "ordax-prototype-release-v1"

	maxTrustDocument = 16 << 10
	maxStateDocument = 32 << 10
	maxProtectedKey  = 64 << 10
)

var proofMessage = []byte("prototype-ordax.creator-local-trust-proof/1\n")

type Anchor struct {
	Schema       string `json:"$schema"`
	KeyID        string `json:"key_id"`
	PublicKeyB64 string `json:"public_key_base64"`
}

type stateDocument struct {
	Schema                 string `json:"$schema"`
	Status                 string `json:"status"`
	KeyID                  string `json:"key_id"`
	PublicTrustSHA256      string `json:"public_trust_sha256"`
	PrivateKeyProtection   string `json:"private_key_protection"`
	ProofVerified          bool   `json:"proof_verified"`
	OfflineBackupRequired  bool   `json:"offline_backup_required"`
	ReadyToPinPublicAnchor bool   `json:"ready_to_pin_public_anchor"`
}

type Snapshot struct {
	Schema                 string `json:"$schema"`
	Status                 string `json:"status"`
	Configured             bool   `json:"configured"`
	Valid                  bool   `json:"valid"`
	KeyID                  string `json:"key_id,omitempty"`
	PublicTrustPath        string `json:"public_trust_path,omitempty"`
	PublicTrustSHA256      string `json:"public_trust_sha256,omitempty"`
	PrivateKeyProtected    bool   `json:"private_key_protected"`
	PrivateKeyProtection   string `json:"private_key_protection,omitempty"`
	ProofVerified          bool   `json:"proof_verified"`
	OfflineBackupRequired  bool   `json:"offline_backup_required"`
	ReadyToPinPublicAnchor bool   `json:"ready_to_pin_public_anchor"`
}

type Paths struct {
	SecretDirectory string
	ReviewDirectory string
	ProtectedKey    string
	PublicTrust     string
	State           string
}

func DefaultPaths() (Paths, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return Paths{}, errors.New("Windows user profile is unavailable")
	}
	secret := filepath.Join(home, "OrdaX-Private", "release-signing")
	review := filepath.Join(home, "OrdaX-Creator", "trust-review")
	return Paths{
		SecretDirectory: secret,
		ReviewDirectory: review,
		ProtectedKey:    filepath.Join(secret, "ordax-release-private.dpapi"),
		PublicTrust:     filepath.Join(review, "release-ed25519.json"),
		State:           filepath.Join(review, "local-trust-state.json"),
	}, nil
}

func Inspect() (Snapshot, error) {
	paths, err := DefaultPaths()
	if err != nil {
		return Snapshot{}, err
	}
	return inspect(paths)
}

func Initialize() (Snapshot, error) {
	paths, err := DefaultPaths()
	if err != nil {
		return Snapshot{}, err
	}
	return initialize(paths)
}

func inspect(paths Paths) (Snapshot, error) {
	exists := []bool{fileExists(paths.ProtectedKey), fileExists(paths.PublicTrust), fileExists(paths.State)}
	count := 0
	for _, present := range exists {
		if present {
			count++
		}
	}
	if count == 0 {
		return Snapshot{Schema: SnapshotSchema, Status: "not-configured"}, nil
	}
	if count != len(exists) {
		return Snapshot{}, errors.New("release trust is partially configured; refusing to guess or overwrite existing security material")
	}

	stateBytes, err := readRegular(paths.State, maxStateDocument)
	if err != nil {
		return Snapshot{}, fmt.Errorf("read local trust state: %w", err)
	}
	var state stateDocument
	if err := decodeStrict(stateBytes, &state); err != nil {
		return Snapshot{}, fmt.Errorf("decode local trust state: %w", err)
	}
	if state.Schema != StateSchema || state.KeyID != KeyID || !state.ProofVerified {
		return Snapshot{}, errors.New("local trust state is not a supported verified OrdaX identity")
	}

	trustBytes, err := readRegular(paths.PublicTrust, maxTrustDocument)
	if err != nil {
		return Snapshot{}, fmt.Errorf("read public trust anchor: %w", err)
	}
	var anchor Anchor
	if err := decodeStrict(trustBytes, &anchor); err != nil {
		return Snapshot{}, fmt.Errorf("decode public trust anchor: %w", err)
	}
	if anchor.Schema != AnchorSchema || anchor.KeyID != KeyID {
		return Snapshot{}, errors.New("public trust anchor schema/key id mismatch")
	}
	publicKey, err := base64.StdEncoding.Strict().DecodeString(anchor.PublicKeyB64)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return Snapshot{}, errors.New("public trust anchor contains an invalid Ed25519 key")
	}

	trustHash := sha256.Sum256(trustBytes)
	trustHashHex := hex.EncodeToString(trustHash[:])
	if trustHashHex != state.PublicTrustSHA256 {
		return Snapshot{}, errors.New("public trust anchor hash does not match the protected local identity")
	}

	protectedBytes, err := readRegular(paths.ProtectedKey, maxProtectedKey)
	if err != nil {
		return Snapshot{}, fmt.Errorf("read protected private key: %w", err)
	}
	privateDER, protection, err := unprotectPrivateKey(protectedBytes)
	if err != nil {
		return Snapshot{}, fmt.Errorf("unlock protected private key: %w", err)
	}
	defer clear(privateDER)
	parsed, err := x509.ParsePKCS8PrivateKey(privateDER)
	if err != nil {
		return Snapshot{}, fmt.Errorf("parse protected private key: %w", err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(privateKey) != ed25519.PrivateKeySize {
		return Snapshot{}, errors.New("protected private key is not Ed25519")
	}
	defer clear(privateKey)
	derived, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok || !bytes.Equal(derived, publicKey) {
		return Snapshot{}, errors.New("protected private key does not match the public trust anchor")
	}
	signature := ed25519.Sign(privateKey, proofMessage)
	if !ed25519.Verify(derived, proofMessage, signature) {
		return Snapshot{}, errors.New("local release identity failed its signing proof")
	}
	if protection != state.PrivateKeyProtection {
		return Snapshot{}, errors.New("private-key protection mechanism differs from recorded trust state")
	}

	return Snapshot{
		Schema:                 SnapshotSchema,
		Status:                 state.Status,
		Configured:             true,
		Valid:                  true,
		KeyID:                  state.KeyID,
		PublicTrustPath:        paths.PublicTrust,
		PublicTrustSHA256:      state.PublicTrustSHA256,
		PrivateKeyProtected:    true,
		PrivateKeyProtection:   state.PrivateKeyProtection,
		ProofVerified:          true,
		OfflineBackupRequired:  state.OfflineBackupRequired,
		ReadyToPinPublicAnchor: state.ReadyToPinPublicAnchor,
	}, nil
}

func initialize(paths Paths) (Snapshot, error) {
	current, err := inspect(paths)
	if err != nil {
		return Snapshot{}, err
	}
	if current.Configured {
		return current, nil
	}

	if err := os.MkdirAll(paths.SecretDirectory, 0o700); err != nil {
		return Snapshot{}, fmt.Errorf("create private identity directory: %w", err)
	}
	if err := os.MkdirAll(paths.ReviewDirectory, 0o700); err != nil {
		return Snapshot{}, fmt.Errorf("create public review directory: %w", err)
	}
	for _, path := range []string{paths.ProtectedKey, paths.PublicTrust, paths.State} {
		if fileExists(path) {
			return Snapshot{}, errors.New("release trust output already exists; overwrite is forbidden")
		}
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Snapshot{}, fmt.Errorf("generate Ed25519 release identity: %w", err)
	}
	defer clear(privateKey)
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return Snapshot{}, fmt.Errorf("encode Ed25519 private key: %w", err)
	}
	defer clear(privateDER)
	protected, protection, err := protectPrivateKey(privateDER)
	if err != nil {
		return Snapshot{}, fmt.Errorf("protect private key with Windows: %w", err)
	}
	defer clear(protected)

	anchor := Anchor{
		Schema:       AnchorSchema,
		KeyID:        KeyID,
		PublicKeyB64: base64.StdEncoding.EncodeToString(publicKey),
	}
	trustBytes, err := marshalJSON(anchor)
	if err != nil {
		return Snapshot{}, err
	}
	trustHash := sha256.Sum256(trustBytes)
	trustHashHex := hex.EncodeToString(trustHash[:])

	signature := ed25519.Sign(privateKey, proofMessage)
	if !ed25519.Verify(publicKey, proofMessage, signature) {
		return Snapshot{}, errors.New("new release identity failed its signing proof")
	}

	state := stateDocument{
		Schema:                 StateSchema,
		Status:                 "local-key-protected-public-anchor-ready-backup-pending",
		KeyID:                  KeyID,
		PublicTrustSHA256:      trustHashHex,
		PrivateKeyProtection:   protection,
		ProofVerified:          true,
		OfflineBackupRequired:  true,
		ReadyToPinPublicAnchor: false,
	}
	stateBytes, err := marshalJSON(state)
	if err != nil {
		return Snapshot{}, err
	}

	created := make([]string, 0, 3)
	rollback := func() {
		for i := len(created) - 1; i >= 0; i-- {
			_ = os.Remove(created[i])
		}
	}
	if err := writeExclusive(paths.ProtectedKey, protected, 0o600); err != nil {
		return Snapshot{}, fmt.Errorf("persist protected private key: %w", err)
	}
	created = append(created, paths.ProtectedKey)
	if err := writeExclusive(paths.PublicTrust, trustBytes, 0o600); err != nil {
		rollback()
		return Snapshot{}, fmt.Errorf("persist public trust anchor: %w", err)
	}
	created = append(created, paths.PublicTrust)
	if err := writeExclusive(paths.State, stateBytes, 0o600); err != nil {
		rollback()
		return Snapshot{}, fmt.Errorf("persist local trust state: %w", err)
	}
	created = append(created, paths.State)

	persisted, err := inspect(paths)
	if err != nil {
		rollback()
		return Snapshot{}, fmt.Errorf("verify persisted release identity: %w", err)
	}
	return persisted, nil
}

func fileExists(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0
}

func readRegular(path string, max int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("file must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > max {
		return nil, fmt.Errorf("file size outside allowed range: %d", info.Size())
	}
	return os.ReadFile(path)
}

func writeExclusive(path string, data []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(data); err != nil {
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

func marshalJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}
