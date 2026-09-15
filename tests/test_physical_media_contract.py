import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "tools" / "creator" / "proof" / "disposable_media.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "physical-media.json"

SPEC = importlib.util.spec_from_file_location("ordax_disposable_media", SCRIPT_PATH)
MEDIA = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MEDIA)


class PhysicalMediaContractTests(unittest.TestCase):
    def load_contract(self):
        return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_canonical_contract_is_fail_closed_and_valid(self):
        contract = self.load_contract()
        MEDIA.validate_contract(contract)
        self.assertFalse(contract["physical_write_allowed"])
        self.assertEqual(contract["partition_table"], "gpt")
        self.assertEqual([p["name"] for p in contract["partitions"]], ["ORDAX-ESP", "ORDAX"])
        self.assertEqual([p["filesystem"] for p in contract["partitions"]], ["fat32", "ext4"])

    def test_geometry_is_one_mib_aligned_and_contiguous(self):
        contract = self.load_contract()
        sector = contract["logical_sector_bytes"]
        alignment_sectors = contract["alignment_bytes"] // sector
        esp, main = contract["partitions"]
        self.assertEqual(esp["start_lba"], alignment_sectors)
        self.assertEqual(esp["size_bytes"] % contract["alignment_bytes"], 0)
        self.assertEqual(
            main["start_lba"],
            esp["start_lba"] + esp["size_bytes"] // sector,
        )
        self.assertEqual(main["start_lba"] % alignment_sectors, 0)

    def test_legacy_third_partitions_are_forbidden(self):
        contract = self.load_contract()
        self.assertIn("ORDAX-HOME", contract["forbidden_partitions"])
        self.assertIn("ORDAX-PLATFORM", contract["forbidden_partitions"])

    def test_stage_tree_rejects_extra_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "ORDAX-ESP").mkdir()
            (root / "ORDAX").mkdir()
            (root / "EXTRA").mkdir()
            with self.assertRaisesRegex(MEDIA.ProofError, "exactly ORDAX-ESP and ORDAX"):
                MEDIA.inspect_stage_tree(root)

    def test_stage_tree_rejects_symlink(self):
        if not hasattr(Path, "symlink_to"):
            self.skipTest("symlinks unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            root = temporary_root / "stage"
            root.mkdir()
            esp = root / "ORDAX-ESP"
            main = root / "ORDAX"
            esp.mkdir()
            main.mkdir()
            target = temporary_root / "outside"
            target.write_bytes(b"unsafe")
            try:
                (esp / "BOOTX64.EFI").symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation unavailable")
            with self.assertRaisesRegex(MEDIA.ProofError, "unsafe staged file"):
                MEDIA.inspect_stage_tree(root)

    def test_sgdisk_info_parser_requires_all_critical_fields(self):
        info = MEDIA.parse_sgdisk_info(
            """Partition GUID code: C12A7328-F81F-11D2-BA4B-00A0C93EC93B (EFI system partition)
First sector: 2048 (at 1024.0 KiB)
Last sector: 526335 (at 257.0 MiB)
Partition name: 'ORDAX-ESP'
"""
        )
        self.assertEqual(info["first_lba"], 2048)
        self.assertEqual(info["sector_count"], 524288)
        self.assertEqual(info["name"], "ORDAX-ESP")
        self.assertEqual(info["type_guid"], MEDIA.ESP_TYPE_GUID)


if __name__ == "__main__":
    unittest.main()
