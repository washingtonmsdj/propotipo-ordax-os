#!/usr/bin/env python3
"""Regression tests for durable OrdaX storage architecture."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_PATH = ROOT / "docs" / "contracts" / "foundation.json"
STORAGE_PATH = ROOT / "docs" / "contracts" / "storage-architecture.json"


class StorageArchitectureContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation = json.loads(FOUNDATION_PATH.read_text(encoding="utf-8"))
        cls.storage = json.loads(STORAGE_PATH.read_text(encoding="utf-8"))

    def test_foundation_points_to_storage_authority(self):
        storage = self.foundation["storage_architecture"]
        self.assertEqual(storage["contract"], "docs/contracts/storage-architecture.json")
        self.assertFalse(storage["single_physical_layout_for_all_media"])
        self.assertEqual(storage["native_disk_profile"], "native-disk")
        self.assertEqual(storage["portable_usb_profile"], "portable-usb")
        self.assertFalse(storage["rigid_system_home_app_partition_sizing_required"])
        self.assertTrue(storage["user_data_preserved_by_default_during_system_repair"])
        self.assertTrue(storage["transactional_update_and_rollback_required"])

    def test_old_physical_media_contract_is_scoped_to_transitional_seed(self):
        media = self.foundation["physical_media"]
        self.assertEqual(media["scope"], "transitional-bootstrap-seed-proof-only")
        self.assertFalse(media["final_product_storage_layout"])
        self.assertEqual(media["contract"], "docs/contracts/physical-media.json")

    def test_native_disk_uses_one_shared_encrypted_btrfs_pool(self):
        native = self.storage["profiles"]["native-disk"]
        self.assertEqual(native["partition_table"], "gpt")
        self.assertEqual([p["name"] for p in native["physical_layout"]], ["ORDAX-ESP", "ORDAX-POOL"])
        pool = native["physical_layout"][1]
        self.assertEqual(pool["filesystem"], "btrfs")
        self.assertEqual(pool["size_policy"], "fill-all-remaining-install-target-capacity")
        self.assertEqual(pool["encryption"]["format"], "luks2")
        self.assertTrue(pool["encryption"]["default_when-supported"])
        model = native["pool_model"]
        self.assertFalse(model["hard_partition_boundaries_between-system-apps-home"])
        self.assertTrue(model["subvolumes_share_free_space"])
        self.assertFalse(model["fixed-size-home"])
        self.assertFalse(model["fixed-size-app-partition"])
        self.assertFalse(model["fixed-size-system-partition"])

    def test_native_repair_preserves_user_data_by_default(self):
        recovery = self.storage["profiles"]["native-disk"]["recovery"]
        self.assertIn("preserve-user-home", recovery["repair-reinstall-default"])
        self.assertIn("explicit", recovery["factory-reset"])
        delivery = self.storage["profiles"]["native-disk"]["system_delivery"]
        self.assertTrue(delivery["stage-new-version-without-mutating-running-root"])
        self.assertTrue(delivery["retain-known-good-rollback-deployment"])
        self.assertFalse(delivery["physical-a-b-root-partitions"])

    def test_portable_usb_has_no_fixed_physical_system_partition(self):
        portable = self.storage["profiles"]["portable-usb"]
        self.assertEqual([p["name"] for p in portable["target_physical_layout"]], ["ORDAX-ESP", "ORDAX-DATA"])
        data = portable["target_physical_layout"][1]
        self.assertEqual(data["filesystem"], "exfat")
        self.assertEqual(data["size_policy"], "fill-all-remaining-capacity")
        self.assertTrue(data["windows-visible"])
        self.assertFalse(data["direct-overlayfs-upper"])
        image = portable["system_image"]
        self.assertEqual(image["format"], "erofs")
        self.assertTrue(image["compressed"])
        self.assertTrue(image["read_only"])
        self.assertFalse(image["fixed-system-partition"])

    def test_portable_persistence_uses_linux_native_image_inside_shared_data(self):
        state = self.storage["profiles"]["portable-usb"]["persistent_state"]
        self.assertEqual(state["format"], "ext4-filesystem-image")
        self.assertEqual(state["storage"], "ORDAX-DATA/.ordax/state")
        self.assertTrue(state["mounted-through-loop-device"])
        self.assertTrue(state["overlayfs-upper"])
        self.assertFalse(state["exfat-used-directly-as-overlay-upper"])

    def test_storage_contract_forbids_future_rigid_regressions(self):
        forbidden = set(self.storage["forbidden_default_architectures"])
        expected = {
            "one-identical-storage-layout-for-native-disk-and-portable-usb",
            "fixed-size-home-partition-on-native-disk",
            "fixed-size-applications-partition-on-native-disk",
            "physical-a-b-root-partitions-as-the-default-native-update-model",
            "using-exfat-directly-as-a-linux-overlayfs-upper-layer",
            "growing-the-system-partition-to-consume-all-portable-user-capacity",
            "requiring-whole-usb-capacity-to-be-written-and-read-back-when-most-bytes-are-unused",
        }
        self.assertTrue(expected.issubset(forbidden))


if __name__ == "__main__":
    unittest.main()
