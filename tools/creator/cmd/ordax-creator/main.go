package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	creatorcore "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/core"
)

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ordax-creator <check|verify-payload|stage-tree|plan> --manifest <path> [--payload-root <dir>] [--output-root <dir>]")
	fmt.Fprintln(os.Stderr, "       ordax-creator prepare-image --seed <regular-file> --out <new-regular-file> --target-bytes <bytes>")
}

func loadManifest(path string) (creatorcore.Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return creatorcore.Manifest{}, err
	}
	return creatorcore.ParseManifest(data)
}

func runPrepareImage(args []string) int {
	fs := flag.NewFlagSet("prepare-image", flag.ContinueOnError)
	seed := fs.String("seed", "", "verified GPT seed regular-file path")
	out := fs.String("out", "", "new prepared regular-file path")
	targetBytes := fs.Uint64("target-bytes", 0, "exact target capacity in bytes; must be 512-byte aligned")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 0 || *seed == "" || *out == "" || *targetBytes == 0 {
		usage()
		return 2
	}

	prepared, err := creatorcore.PreparePhysicalImage(*seed, *out, *targetBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: prepare image failed: %v\n", err)
		return 1
	}
	fmt.Printf("PREPARED_PHYSICAL_IMAGE=YES\n")
	fmt.Printf("PREPARED_PATH=%s\n", prepared.Path)
	fmt.Printf("PREPARED_SIZE_BYTES=%d\n", prepared.SizeBytes)
	fmt.Printf("PREPARED_SHA256=%s\n", prepared.SHA256)
	fmt.Printf("PREPARED_LAST_USABLE_LBA=%d\n", prepared.LastUsableLBA)
	fmt.Printf("PREPARED_MAIN_LAST_LBA=%d\n", prepared.MainLastLBA)
	fmt.Printf("PHYSICAL_DEVICE_TOUCHED=NO\n")
	return 0
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	command := os.Args[1]
	if command == "prepare-image" {
		os.Exit(runPrepareImage(os.Args[2:]))
	}

	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	manifestPath := fs.String("manifest", "docs/contracts/minimal-bootstrap.json", "path to minimal-bootstrap manifest")
	payloadRoot := fs.String("payload-root", "", "root directory of the assembled Creator payload")
	outputRoot := fs.String("output-root", "", "empty output directory for disposable filesystem-tree staging")
	if err := fs.Parse(os.Args[2:]); err != nil {
		os.Exit(2)
	}
	if fs.NArg() != 0 {
		usage()
		os.Exit(2)
	}

	manifest, err := loadManifest(*manifestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: load manifest: %v\n", err)
		os.Exit(1)
	}
	if err := creatorcore.ValidateStructure(manifest); err != nil {
		fmt.Fprintf(os.Stderr, "ordax-creator: invalid manifest: %v\n", err)
		os.Exit(1)
	}

	switch command {
	case "check":
		fmt.Printf("MANIFEST_SCHEMA=%s\n", manifest.Schema)
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
		fmt.Printf("PARTITIONS=ORDAX-ESP,ORDAX\n")
	case "verify-payload":
		result, err := creatorcore.VerifyPayload(manifest, *payloadRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: payload verification failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("PAYLOAD_VERIFIED=YES\n")
		fmt.Printf("PAYLOAD_ARTIFACTS=%d\n", result.ArtifactCount)
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
	case "stage-tree":
		result, err := creatorcore.StageDisposableTree(manifest, *payloadRoot, *outputRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: disposable tree staging failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("DISPOSABLE_TREE_STAGED=YES\n")
		fmt.Printf("STAGED_ARTIFACTS=%d\n", result.ArtifactCount)
		fmt.Printf("STAGED_RUNTIME_ROOTS=%d\n", result.RuntimeRootCount)
		fmt.Printf("GPT_FILESYSTEM_PROOF=NO\n")
		fmt.Printf("PHYSICAL_WRITE_STATUS=%s\n", creatorcore.PhysicalWriteStatus(manifest))
	case "plan":
		plan, err := creatorcore.BuildWritePlan(manifest)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: %v\n", err)
			os.Exit(1)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(plan); err != nil {
			fmt.Fprintf(os.Stderr, "ordax-creator: encode plan: %v\n", err)
			os.Exit(1)
		}
	default:
		usage()
		os.Exit(2)
	}
}
