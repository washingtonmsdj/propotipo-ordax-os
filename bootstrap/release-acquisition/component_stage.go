package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func readComponentRelease(path string) (ComponentReleaseManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ComponentReleaseManifest{}, err
	}
	var manifest ComponentReleaseManifest
	if err := strictDecode(data, maxPayload, &manifest); err != nil {
		return ComponentReleaseManifest{}, err
	}
	return manifest, nil
}

func cleanupComponentStages(versions string) error {
	entries, err := os.ReadDir(versions)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".staging-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe runtime component staging residue: %s", entry.Name())
		}
		if err := os.RemoveAll(filepath.Join(versions, entry.Name())); err != nil {
			return err
		}
	}
	return syncDir(versions)
}

func checkComponentRollback(componentRoot string, candidate ComponentReleaseManifest) error {
	versions := filepath.Join(componentRoot, "versions")
	if err := cleanupComponentStages(versions); err != nil {
		return err
	}
	entries, err := os.ReadDir(versions)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var highest *ComponentReleaseManifest
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			return fmt.Errorf("unexpected hidden runtime component version entry: %s", entry.Name())
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe runtime component version entry: %s", entry.Name())
		}
		if !componentVersionPattern.MatchString(entry.Name()) {
			return fmt.Errorf("runtime component version directory has invalid name: %s", entry.Name())
		}
		manifest, err := readComponentRelease(filepath.Join(versions, entry.Name(), "component-release.json"))
		if err != nil {
			return fmt.Errorf("cannot establish runtime component anti-rollback baseline: %w", err)
		}
		if err := validateComponentReleaseManifest(manifest, candidate.SourceRepository, candidate.ComponentID); err != nil {
			return fmt.Errorf("installed runtime component release is invalid: %w", err)
		}
		if manifest.Version != entry.Name() {
			return errors.New("runtime component version directory disagrees with signed release")
		}
		if highest == nil || manifest.ReleaseSequence > highest.ReleaseSequence {
			copy := manifest
			highest = &copy
		}
	}
	if highest == nil {
		return nil
	}
	if candidate.ReleaseSequence < highest.ReleaseSequence {
		return fmt.Errorf(
			"runtime component rollback rejected: candidate sequence %d is older than installed sequence %d",
			candidate.ReleaseSequence,
			highest.ReleaseSequence,
		)
	}
	if candidate.ReleaseSequence == highest.ReleaseSequence &&
		(candidate.Version != highest.Version || candidate.SourceCommit != highest.SourceCommit) {
		return fmt.Errorf(
			"runtime component release sequence %d was reused by a different release",
			candidate.ReleaseSequence,
		)
	}
	return nil
}

func extractComponentPackage(packageBytes []byte, stage string, release ComponentReleaseManifest) error {
	manifest, files, err := componentPackageFiles(packageBytes, release)
	if err != nil {
		return err
	}
	for _, record := range manifest.Files {
		item := files[record.Path]
		payload, err := readZipFileBounded(item, maxComponentFile)
		if err != nil {
			return err
		}
		target := filepath.Join(stage, filepath.FromSlash(record.Path))
		if err := ensureDir(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := writeSynced(target, payload, 0o644); err != nil {
			return err
		}
		if err := syncDir(filepath.Dir(target)); err != nil {
			return err
		}
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	manifestBytes = append(manifestBytes, '\n')
	if err := writeSynced(filepath.Join(stage, "component-package.json"), manifestBytes, 0o644); err != nil {
		return err
	}
	return syncDir(stage)
}

func verifyStagedComponent(path string, release ComponentReleaseManifest, payload, envelope []byte) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("runtime component stage is not a safe directory")
	}

	storedPayload, err := os.ReadFile(filepath.Join(path, "component-release.json"))
	if err != nil || !bytes.Equal(storedPayload, payload) {
		return errors.New("staged runtime component release differs from signed payload")
	}
	storedEnvelope, err := os.ReadFile(filepath.Join(path, "component-envelope.json"))
	if err != nil || !bytes.Equal(storedEnvelope, envelope) {
		return errors.New("staged runtime component envelope differs from verified envelope")
	}
	packageBytes, err := os.ReadFile(filepath.Join(path, "component-package.zip"))
	if err != nil {
		return err
	}
	manifest, err := verifyComponentPackageBytes(packageBytes, release)
	if err != nil {
		return err
	}

	expectedTop := map[string]bool{
		"component-envelope.json": true,
		"component-package.json":  true,
		"component-package.zip":   true,
		"component-release.json":  true,
		"system":                  true,
	}
	topEntries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	for _, entry := range topEntries {
		if !expectedTop[entry.Name()] {
			return fmt.Errorf("staged runtime component contains unexpected top-level entry: %s", entry.Name())
		}
	}

	for _, record := range manifest.Files {
		target := filepath.Join(path, filepath.FromSlash(record.Path))
		actualHash, actualSize, err := hashFile(target)
		if err != nil || actualSize != record.Size || actualHash != record.SHA256 {
			return fmt.Errorf("staged runtime component file differs from package: %s", record.Path)
		}
	}
	return nil
}

func stageComponent(
	client *http.Client,
	envelopeURL,
	root string,
	trust TrustAnchor,
	key ed25519.PublicKey,
	expectedRepo,
	expectedComponent string,
) (ComponentStageReceipt, error) {
	envelope, err := fetchBytes(client, envelopeURL, maxEnvelope)
	if err != nil {
		return ComponentStageReceipt{}, fmt.Errorf("fetch runtime component envelope: %w", err)
	}
	release, payload, err := verifyComponentEnvelope(
		envelope,
		trust,
		key,
		expectedRepo,
		expectedComponent,
	)
	if err != nil {
		return ComponentStageReceipt{}, err
	}

	if err := ensureDir(root, 0o755); err != nil {
		return ComponentStageReceipt{}, err
	}
	componentRoot := filepath.Join(root, release.ComponentID)
	if err := ensureDir(componentRoot, 0o755); err != nil {
		return ComponentStageReceipt{}, err
	}
	versions := filepath.Join(componentRoot, "versions")
	if err := ensureDir(versions, 0o755); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := checkComponentRollback(componentRoot, release); err != nil {
		return ComponentStageReceipt{}, err
	}

	target := filepath.Join(versions, release.Version)
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ComponentStageReceipt{}, errors.New("runtime component version target exists but is unsafe")
		}
		if err := verifyStagedComponent(target, release, payload, envelope); err != nil {
			return ComponentStageReceipt{}, err
		}
		return ComponentStageReceipt{
			Schema: componentStageSchema, Status: "staged", ComponentID: release.ComponentID,
			Version: release.Version, SourceCommit: release.SourceCommit,
			ReleaseSequence: release.ReleaseSequence, StagePath: target,
			Idempotent: true, ActivationAllowed: false,
		}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return ComponentStageReceipt{}, err
	}

	packageBytes, err := fetchBytes(client, release.Package.URL, maxComponentPackage)
	if err != nil {
		return ComponentStageReceipt{}, fmt.Errorf("fetch runtime component package: %w", err)
	}
	if _, err := verifyComponentPackageBytes(packageBytes, release); err != nil {
		return ComponentStageReceipt{}, err
	}

	stage, err := os.MkdirTemp(versions, ".staging-"+release.Version+"-")
	if err != nil {
		return ComponentStageReceipt{}, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(stage)
		}
	}()

	if err := extractComponentPackage(packageBytes, stage, release); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "component-package.zip"), packageBytes, 0o644); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "component-release.json"), payload, 0o644); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := writeSynced(filepath.Join(stage, "component-envelope.json"), envelope, 0o644); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := verifyStagedComponent(stage, release, payload, envelope); err != nil {
		return ComponentStageReceipt{}, fmt.Errorf("verify staged runtime component: %w", err)
	}
	if err := syncDir(stage); err != nil {
		return ComponentStageReceipt{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return ComponentStageReceipt{}, err
	}
	keep = true
	if err := syncDir(versions); err != nil {
		return ComponentStageReceipt{}, err
	}

	return ComponentStageReceipt{
		Schema: componentStageSchema, Status: "staged", ComponentID: release.ComponentID,
		Version: release.Version, SourceCommit: release.SourceCommit,
		ReleaseSequence: release.ReleaseSequence, StagePath: target,
		Idempotent: false, ActivationAllowed: false,
	}, nil
}

func verifyComponentCommand(args []string) error {
	fs := flag.NewFlagSet("verify-component-envelope", flag.ContinueOnError)
	envelopePath := fs.String("envelope", "", "signed runtime component envelope file")
	trustPath := fs.String("trust", "", "release trust anchor file")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	componentID := fs.String("component", "", "expected runtime component id")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopePath == "" || *trustPath == "" || *componentID == "" || fs.NArg() != 0 {
		return errors.New("verify-component-envelope requires --envelope, --trust and --component")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*envelopePath)
	if err != nil {
		return err
	}
	manifest, _, err := verifyComponentEnvelope(data, trust, key, *repository, *componentID)
	if err != nil {
		return err
	}
	return printJSON(map[string]any{
		"status": "verified",
		"component_id": manifest.ComponentID,
		"version": manifest.Version,
		"source_commit": manifest.SourceCommit,
		"release_sequence": manifest.ReleaseSequence,
		"activation_allowed": false,
	})
}

func stageComponentCommand(args []string) error {
	fs := flag.NewFlagSet("stage-component", flag.ContinueOnError)
	envelopeURL := fs.String("envelope-url", "", "HTTPS URL for signed runtime component envelope")
	trustPath := fs.String("trust", "", "release trust anchor file")
	root := fs.String("root", "/var/lib/ordax/components", "runtime component immutable stage root")
	repository := fs.String("repository", defaultRepo, "expected source repository")
	componentID := fs.String("component", "", "expected runtime component id")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *envelopeURL == "" || *trustPath == "" || *componentID == "" || fs.NArg() != 0 {
		return errors.New("stage-component requires --envelope-url, --trust and --component")
	}
	trust, key, err := loadTrust(*trustPath)
	if err != nil {
		return err
	}
	receipt, err := stageComponent(
		secureClient(),
		*envelopeURL,
		*root,
		trust,
		key,
		*repository,
		*componentID,
	)
	if err != nil {
		return err
	}
	return printJSON(receipt)
}
