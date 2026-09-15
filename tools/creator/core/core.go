package creatorcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const Schema = "prototype-ordax.minimal-bootstrap/4"

type Partition struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

type Artifact struct {
	SourcePath   string `json:"source_path"`
	TargetPath   string `json:"target_path"`
	SHA256       string `json:"sha256"`
	Mode         string `json:"mode"`
	LogicalOwner string `json:"logical_owner"`
	Reason       string `json:"reason"`
}

type ArtifactGroup struct {
	ID          string     `json:"id"`
	Partition   string     `json:"partition"`
	TargetRoot  string     `json:"target_root,omitempty"`
	SourceOwner string     `json:"source_owner"`
	Resolved    bool       `json:"resolved"`
	Artifacts   []Artifact `json:"artifacts"`
}

type WriteGate struct {
	RequiresAllGroupsResolved                bool `json:"requires_all_groups_resolved"`
	RequiresAllArtifactHashes                bool `json:"requires_all_artifact_hashes"`
	RequiresDisposableLayoutProof            bool `json:"requires_disposable_layout_proof"`
	RequiresExplicitDestructiveAuthorization bool `json:"requires_explicit_destructive_authorization"`
}

type Manifest struct {
	Schema                     string          `json:"$schema"`
	Status                     string          `json:"status"`
	PhysicalWriteAllowed       bool            `json:"physical_write_allowed"`
	AllArtifactsResolved       bool            `json:"all_artifacts_resolved"`
	Policy                     string          `json:"policy"`
	Partitions                 []Partition     `json:"partitions"`
	RequiredCapabilities       []string        `json:"required_capabilities_before_first_release"`
	OptionalCapabilities       []string        `json:"optional_after_first_release"`
	BootPolicy                 json.RawMessage `json:"boot_policy"`
	ArtifactGroups             []ArtifactGroup `json:"artifact_groups"`
	RuntimeRootsCreatedEmpty   []string        `json:"runtime_roots_created_empty"`
	CurrentPointerInitialState string          `json:"current_pointer_initial_state"`
	ForbiddenInitialPayload    []string        `json:"forbidden_initial_payload"`
	ResolutionRequirements     []string        `json:"resolution_requirements_per_artifact"`
	WriteGate                  WriteGate       `json:"write_gate"`
}

type PlanArtifact struct {
	Group      string `json:"group"`
	Partition  string `json:"partition"`
	SourcePath string `json:"source_path"`
	TargetPath string `json:"target_path"`
	SHA256     string `json:"sha256"`
	Mode       string `json:"mode"`
}

type WritePlan struct {
	Schema       string         `json:"$schema"`
	PartitionIDs []string       `json:"partitions"`
	Artifacts    []PlanArtifact `json:"artifacts"`
}

type PayloadVerification struct {
	Schema        string `json:"$schema"`
	ArtifactCount int    `json:"artifact_count"`
}

func ParseManifest(data []byte) (Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return Manifest{}, errors.New("decode manifest: trailing JSON value")
		}
		return Manifest{}, fmt.Errorf("decode manifest trailing content: %w", err)
	}
	return m, nil
}

func ValidateStructure(m Manifest) error {
	if m.Schema != Schema {
		return fmt.Errorf("unsupported manifest schema %q", m.Schema)
	}
	if m.Policy != "minimum-release-acquisition-first" {
		return fmt.Errorf("unexpected media policy %q", m.Policy)
	}
	if len(m.Partitions) != 2 || m.Partitions[0].Name != "ORDAX-ESP" || m.Partitions[1].Name != "ORDAX" {
		return errors.New("physical layout must be exactly ORDAX-ESP + ORDAX")
	}
	if m.CurrentPointerInitialState != "unset" {
		return errors.New("initial current pointer must be unset")
	}
	if !m.WriteGate.RequiresAllGroupsResolved || !m.WriteGate.RequiresAllArtifactHashes || !m.WriteGate.RequiresDisposableLayoutProof || !m.WriteGate.RequiresExplicitDestructiveAuthorization {
		return errors.New("write gate is weaker than the canonical safety contract")
	}

	seenGroups := map[string]bool{}
	for _, group := range m.ArtifactGroups {
		if group.ID == "" || group.Partition == "" || group.SourceOwner == "" {
			return errors.New("artifact group is missing identity fields")
		}
		if group.Partition != "ORDAX-ESP" && group.Partition != "ORDAX" {
			return fmt.Errorf("artifact group %q targets unknown partition %q", group.ID, group.Partition)
		}
		if seenGroups[group.ID] {
			return fmt.Errorf("duplicate artifact group %q", group.ID)
		}
		seenGroups[group.ID] = true
	}
	return nil
}

func PhysicalWriteStatus(m Manifest) string {
	if m.PhysicalWriteAllowed && m.AllArtifactsResolved {
		return "authorized-by-manifest"
	}
	return "blocked"
}

func validSHA256(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func validMode(value string) bool {
	if len(value) != 4 || value[0] != '0' {
		return false
	}
	for _, char := range value[1:] {
		if char < '0' || char > '7' {
			return false
		}
	}
	return true
}

func validBundleSourcePath(value string) bool {
	if value == "" || strings.Contains(value, "\\") || path.IsAbs(value) {
		return false
	}
	clean := path.Clean(value)
	if clean == "." || clean != value || clean == ".." || strings.HasPrefix(clean, "../") {
		return false
	}
	return true
}

func validTargetPath(value string) bool {
	if value == "" || strings.Contains(value, "\\") || !path.IsAbs(value) {
		return false
	}
	clean := path.Clean(value)
	return clean == value && clean != "/"
}

func buildArtifactPlan(m Manifest, requireWriteAuthorization bool) (WritePlan, error) {
	if err := ValidateStructure(m); err != nil {
		return WritePlan{}, err
	}
	if !m.AllArtifactsResolved {
		return WritePlan{}, errors.New("payload blocked: manifest artifacts are not fully resolved")
	}
	if requireWriteAuthorization && !m.PhysicalWriteAllowed {
		return WritePlan{}, errors.New("physical write blocked: manifest is not authorized")
	}

	plan := WritePlan{
		Schema:       "prototype-ordax.creator-write-plan/1",
		PartitionIDs: []string{"ORDAX-ESP", "ORDAX"},
	}
	seenTargets := map[string]bool{}
	for _, group := range m.ArtifactGroups {
		if !group.Resolved || len(group.Artifacts) == 0 {
			return WritePlan{}, fmt.Errorf("payload blocked: unresolved artifact group %q", group.ID)
		}
		for _, artifact := range group.Artifacts {
			if !validBundleSourcePath(artifact.SourcePath) || !validTargetPath(artifact.TargetPath) || !validSHA256(artifact.SHA256) || !validMode(artifact.Mode) || artifact.LogicalOwner == "" || artifact.Reason == "" {
				return WritePlan{}, fmt.Errorf("payload blocked: incomplete or unsafe artifact in group %q", group.ID)
			}
			targetKey := group.Partition + "\x00" + artifact.TargetPath
			if seenTargets[targetKey] {
				return WritePlan{}, fmt.Errorf("payload blocked: duplicate target %q on %s", artifact.TargetPath, group.Partition)
			}
			seenTargets[targetKey] = true
			plan.Artifacts = append(plan.Artifacts, PlanArtifact{
				Group: group.ID, Partition: group.Partition, SourcePath: artifact.SourcePath,
				TargetPath: artifact.TargetPath, SHA256: artifact.SHA256, Mode: artifact.Mode,
			})
		}
	}
	sort.Slice(plan.Artifacts, func(i, j int) bool {
		if plan.Artifacts[i].Partition == plan.Artifacts[j].Partition {
			return plan.Artifacts[i].TargetPath < plan.Artifacts[j].TargetPath
		}
		return plan.Artifacts[i].Partition < plan.Artifacts[j].Partition
	})
	return plan, nil
}

func BuildWritePlan(m Manifest) (WritePlan, error) {
	return buildArtifactPlan(m, true)
}

func verifyRegularBundleFile(root string, sourcePath string, expectedSHA256 string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve payload root: %w", err)
	}
	rootInfo, err := os.Lstat(rootAbs)
	if err != nil {
		return fmt.Errorf("stat payload root: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return errors.New("payload root must be a real directory, not a symlink")
	}

	current := rootAbs
	parts := strings.Split(sourcePath, "/")
	for index, part := range parts {
		current = filepath.Join(current, filepath.FromSlash(part))
		info, err := os.Lstat(current)
		if err != nil {
			return fmt.Errorf("payload artifact %q missing: %w", sourcePath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("payload artifact %q traverses a symlink", sourcePath)
		}
		if index < len(parts)-1 && !info.IsDir() {
			return fmt.Errorf("payload artifact %q has a non-directory parent", sourcePath)
		}
		if index == len(parts)-1 && !info.Mode().IsRegular() {
			return fmt.Errorf("payload artifact %q is not a regular file", sourcePath)
		}
	}

	file, err := os.Open(current)
	if err != nil {
		return fmt.Errorf("open payload artifact %q: %w", sourcePath, err)
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return fmt.Errorf("hash payload artifact %q: %w", sourcePath, err)
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if actual != expectedSHA256 {
		return fmt.Errorf("payload artifact %q SHA-256 mismatch: expected=%s actual=%s", sourcePath, expectedSHA256, actual)
	}
	return nil
}

// VerifyPayload verifies the fully resolved Creator bundle before destructive
// authorization. source_path is always interpreted as a slash-separated path
// relative to payloadRoot; absolute paths, traversal and symlinks are rejected.
func VerifyPayload(m Manifest, payloadRoot string) (PayloadVerification, error) {
	plan, err := buildArtifactPlan(m, false)
	if err != nil {
		return PayloadVerification{}, err
	}
	if payloadRoot == "" {
		return PayloadVerification{}, errors.New("payload root is required")
	}
	for _, artifact := range plan.Artifacts {
		if err := verifyRegularBundleFile(payloadRoot, artifact.SourcePath, artifact.SHA256); err != nil {
			return PayloadVerification{}, err
		}
	}
	return PayloadVerification{
		Schema:        "prototype-ordax.creator-payload-verification/1",
		ArtifactCount: len(plan.Artifacts),
	}, nil
}
