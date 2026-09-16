package creatorcore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type preparedMediaContract struct {
	Schema             string `json:"$schema"`
	Status             string `json:"status"`
	Scope              string `json:"scope"`
	PartitionTable     string `json:"partition_table"`
	LogicalSectorBytes uint64 `json:"logical_sector_bytes"`
	AlignmentBytes     uint64 `json:"alignment_bytes"`
	GPTTailSectors     uint64 `json:"gpt_tail_sectors"`
	Partitions         []struct {
		Index                      int    `json:"index"`
		Name                       string `json:"name"`
		Role                       string `json:"role"`
		GPTTypeGUID                string `json:"gpt_type_guid"`
		Filesystem                 string `json:"filesystem"`
		FilesystemLabel            string `json:"filesystem_label"`
		StartLBA                   uint64 `json:"start_lba"`
		SizeBytes                  uint64 `json:"size_bytes"`
		MinimumBytes               uint64 `json:"minimum_bytes"`
		WindowsDriveLetterRequired bool   `json:"windows_drive_letter_required"`
		SizePolicy                 any    `json:"size_policy"`
	} `json:"partitions"`
	Performance struct {
		PreparedImageIntegrityScope string `json:"prepared_image_integrity_scope"`
		CurrentRawWriteScope        string `json:"current_raw_write_scope"`
		CurrentReadbackScope        string `json:"current_readback_scope"`
		ZeroRegionSkip              bool   `json:"zero-region-skip_implemented"`
		SkippedRegionOwner          string `json:"skipped_region_owner"`
		FailClosedRule              string `json:"fail_closed_rule"`
	} `json:"performance"`
}

func loadPreparedMediaContractForTest(t *testing.T) preparedMediaContract {
	t.Helper()
	path := filepath.Join("..", "..", "..", "docs", "contracts", "physical-prepared-media.json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read prepared media contract: %v", err)
	}
	var contract preparedMediaContract
	if err := json.Unmarshal(payload, &contract); err != nil {
		t.Fatalf("decode prepared media contract: %v", err)
	}
	return contract
}

func TestPreparedMediaContractMatchesStoragePlanner(t *testing.T) {
	contract := loadPreparedMediaContractForTest(t)
	if contract.Schema != "prototype-ordax.physical-prepared-media/1" {
		t.Fatalf("unexpected schema %q", contract.Schema)
	}
	if contract.Scope != "final-target-usb-after-creator-preparation" {
		t.Fatalf("unexpected contract scope %q", contract.Scope)
	}
	if contract.PartitionTable != "gpt" {
		t.Fatalf("partition table=%q want=gpt", contract.PartitionTable)
	}
	if contract.LogicalSectorBytes != storageSectorBytes {
		t.Fatalf("sector bytes=%d want=%d", contract.LogicalSectorBytes, storageSectorBytes)
	}
	if contract.AlignmentBytes != storageAlignmentBytes {
		t.Fatalf("alignment bytes=%d want=%d", contract.AlignmentBytes, storageAlignmentBytes)
	}
	if contract.GPTTailSectors != storageGPTTailSectors {
		t.Fatalf("GPT tail sectors=%d want=%d", contract.GPTTailSectors, storageGPTTailSectors)
	}
	if len(contract.Partitions) != 3 {
		t.Fatalf("prepared media must define exactly three partitions; got=%d", len(contract.Partitions))
	}

	esp, main, data := contract.Partitions[0], contract.Partitions[1], contract.Partitions[2]
	if esp.Index != 1 || esp.Name != "ORDAX-ESP" || esp.Filesystem != "fat32" || esp.StartLBA != storageESPStartLBA || esp.SizeBytes != storageESPBytes {
		t.Fatalf("ORDAX-ESP contract drift: %+v", esp)
	}
	if main.Index != 2 || main.Name != "ORDAX" || main.Filesystem != "ext4" || main.StartLBA != storageESPStartLBA+storageESPBytes/storageSectorBytes {
		t.Fatalf("ORDAX contract drift: %+v", main)
	}
	policy, ok := main.SizePolicy.(map[string]any)
	if !ok {
		t.Fatalf("ORDAX size policy must be an object; got=%T", main.SizePolicy)
	}
	if got := uint64(policy["minimum_bytes"].(float64)); got != storageMainMinBytes {
		t.Fatalf("ORDAX minimum=%d want=%d", got, storageMainMinBytes)
	}
	if got := uint64(policy["maximum_bytes"].(float64)); got != storageMainMaxBytes {
		t.Fatalf("ORDAX maximum=%d want=%d", got, storageMainMaxBytes)
	}
	if policy["preferred_target_fraction_numerator"] != float64(1) || policy["preferred_target_fraction_denominator"] != float64(4) {
		t.Fatalf("ORDAX preferred target fraction must remain 1/4")
	}
	if data.Index != 3 || data.Name != "ORDAX-DATA" || data.Filesystem != "exfat" || data.FilesystemLabel != "ORDAX-DATA" {
		t.Fatalf("ORDAX-DATA contract drift: %+v", data)
	}
	if data.GPTTypeGUID != "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7" {
		t.Fatalf("ORDAX-DATA GPT type drift: %q", data.GPTTypeGUID)
	}
	if data.MinimumBytes != storageDataMinBytes {
		t.Fatalf("ORDAX-DATA minimum=%d want=%d", data.MinimumBytes, storageDataMinBytes)
	}
	if !data.WindowsDriveLetterRequired {
		t.Fatal("ORDAX-DATA must remain visible through a Windows drive letter")
	}

	if contract.Performance.PreparedImageIntegrityScope != "canonical-write-plan-sha256-over-target-capacity-region-metadata-and-exact-source-bytes" {
		t.Fatalf("prepared image integrity scope drift: %q", contract.Performance.PreparedImageIntegrityScope)
	}
	if contract.Performance.CurrentRawWriteScope != "bootstrap-system-plus-16MiB-ORDAX-DATA-prefix-plus-1MiB-ORDAX-DATA-suffix-plus-secondary-gpt" {
		t.Fatalf("raw write scope drift: %q", contract.Performance.CurrentRawWriteScope)
	}
	if contract.Performance.CurrentReadbackScope != "exactly-the-raw-regions-written-before-ORDAX-DATA-format" {
		t.Fatalf("readback scope drift: %q", contract.Performance.CurrentReadbackScope)
	}
	if !contract.Performance.ZeroRegionSkip {
		t.Fatal("prepared media must skip capacity-only space after validating exact storage-v2 GPT geometry")
	}
	if contract.Performance.SkippedRegionOwner != "the-unformatted-middle-of-ORDAX-DATA-is-immediately-replaced-by-Windows-exFAT-formatting" {
		t.Fatalf("skipped region ownership drift: %q", contract.Performance.SkippedRegionOwner)
	}
	if contract.Performance.FailClosedRule != "supported-real-USB-capacities-require-exact-storage-v2-GPT-validation-and-never-fall-back-to-whole-disk-write-on-validation-failure" {
		t.Fatalf("fail-closed write rule drift: %q", contract.Performance.FailClosedRule)
	}
}

func TestPreparedMediaEightGigabyteExamplePreservesPortableSpace(t *testing.T) {
	layout, err := PlanPhysicalStorage(8_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if layout.MainBytes != storageMainMinBytes {
		t.Fatalf("8 GB target ORDAX bytes=%d want=%d", layout.MainBytes, storageMainMinBytes)
	}
	if layout.DataBytes <= 5_000_000_000 {
		t.Fatalf("8 GB target should preserve more than 5 decimal GB for ORDAX-DATA; got=%d", layout.DataBytes)
	}
	if layout.DataLastLBA != layout.LastUsableLBA {
		t.Fatal("ORDAX-DATA must consume the remaining usable GPT capacity")
	}
}
