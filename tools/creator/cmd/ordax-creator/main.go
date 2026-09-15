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
}

func loadManifest(path string) (creatorcore.Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return creatorcore.Manifest{}, err
	}
	return creatorcore.ParseManifest(data)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	command := os.Args[1]
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	manifestPath := fs.String("manifest", "docs/contracts/minimal-bootstrap.json", "path to minimal-bootstrap manifest")
	payloadRoot := fs.String("payload-root", "", "root directory of the assembled Creator payload")
	outputRoot := fs.String("output-root", "", "empty output directory for disposable filesystem-tree staging")
	if err := fs.Parse(os.Args[2:]); err != nil {
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
