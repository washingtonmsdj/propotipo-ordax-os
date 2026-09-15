package physicalchannel

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	physicalProvenanceSchema = "prototype-ordax.physical-write-candidate/1"
	maxProvenanceBytes       = 64 << 10
)

type physicalProvenance struct {
	Schema                          string `json:"$schema"`
	Status                          string `json:"status"`
	SourceCommit                    string `json:"source_commit"`
	ReleaseSequence                 int64  `json:"release_sequence"`
	ConsumerKeySetupRequired        bool   `json:"consumer_key_setup_required"`
	DevelopmentChannel              bool   `json:"development_channel"`
	CanonicalTrustSHA256            string `json:"canonical_trust_sha256"`
	MinimalBootstrapSHA256          string `json:"minimal_bootstrap_sha256"`
	PhysicalMediaSHA256             string `json:"physical_media_sha256"`
	SeedSHA256                      string `json:"seed_sha256"`
	SeedSize                        int64  `json:"seed_size"`
	RawBackendLinked                bool   `json:"raw_backend_linked"`
	PhysicalWriteAuthorizedInBinary bool   `json:"physical_write_authorized_in_binary"`
	ReleasePublished                bool   `json:"release_published"`
	PrivateKeyInCandidate           bool   `json:"private_key_in_candidate"`
}

// ReleaseSequence reads the monotonic physical-release sequence from the
// provenance file whose exact bytes are already bound by the signed manifest.
// It deliberately re-runs VerifyInstalled so callers cannot inspect unbound or
// modified provenance bytes.
func ReleaseSequence(installed Installed) (int64, error) {
	if err := VerifyInstalled(installed.Directory, installed.Manifest); err != nil {
		return 0, err
	}
	path := filepath.Join(installed.Directory, "provenance.json")
	info, err := os.Lstat(path)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return 0, errors.New("physical provenance is not a regular non-symlink file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var provenance physicalProvenance
	if err := decodeStrict(data, maxProvenanceBytes, &provenance); err != nil {
		return 0, fmt.Errorf("decode physical provenance: %w", err)
	}
	if provenance.Schema != physicalProvenanceSchema {
		return 0, errors.New("unsupported physical provenance schema")
	}
	if provenance.Status != "authorized-candidate-not-published" {
		return 0, fmt.Errorf("unexpected physical provenance status %q", provenance.Status)
	}
	if provenance.SourceCommit != installed.SourceCommit || provenance.SourceCommit != installed.Manifest.SourceCommit {
		return 0, errors.New("physical provenance source commit does not match signed manifest")
	}
	if provenance.ReleaseSequence <= 0 {
		return 0, errors.New("physical release sequence must be positive")
	}
	if provenance.ConsumerKeySetupRequired || provenance.DevelopmentChannel || provenance.PrivateKeyInCandidate {
		return 0, errors.New("physical provenance violates consumer/publisher boundary")
	}
	if !provenance.RawBackendLinked || !provenance.PhysicalWriteAuthorizedInBinary {
		return 0, errors.New("physical provenance does not describe an authorized raw writer")
	}
	for name, value := range map[string]string{
		"canonical_trust_sha256":   provenance.CanonicalTrustSHA256,
		"minimal_bootstrap_sha256": provenance.MinimalBootstrapSHA256,
		"physical_media_sha256":    provenance.PhysicalMediaSHA256,
		"seed_sha256":              provenance.SeedSHA256,
	} {
		if !shaPattern.MatchString(value) {
			return 0, fmt.Errorf("physical provenance %s is invalid", name)
		}
	}
	if provenance.SeedSize <= 0 {
		return 0, errors.New("physical provenance seed size must be positive")
	}
	return provenance.ReleaseSequence, nil
}

func ensureNotRollback(root string, candidate Installed, trustBytes []byte, expectedTrustSHA256 string) error {
	candidateSequence, err := ReleaseSequence(candidate)
	if err != nil {
		return fmt.Errorf("candidate physical release sequence invalid: %w", err)
	}
	current, err := Current(root, trustBytes, expectedTrustSHA256)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("existing physical release baseline is invalid; refusing rollback-sensitive update: %w", err)
	}
	currentSequence, err := ReleaseSequence(current)
	if err != nil {
		return fmt.Errorf("current physical release sequence invalid: %w", err)
	}
	if candidateSequence < currentSequence {
		return fmt.Errorf("physical release rollback rejected: candidate sequence %d is older than current sequence %d", candidateSequence, currentSequence)
	}
	if candidateSequence == currentSequence && candidate.SourceCommit != current.SourceCommit {
		return fmt.Errorf("physical release sequence %d was reused by a different source commit", candidateSequence)
	}
	return nil
}
