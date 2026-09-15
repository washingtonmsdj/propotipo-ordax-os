#!/usr/bin/env python3
"""Regression tests for the clean-room foundation contract."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "foundation.json"


class FoundationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_git_main_is_source_authority(self):
        source = self.contract["source_authority"]
        self.assertEqual(source["kind"], "git")
        self.assertEqual(source["branch"], "main")
        self.assertFalse(source["physical_media_is_source_authority"])
        self.assertFalse(source["notebook_is_source_authority"])

    def test_physical_layout_has_exactly_two_partitions(self):
        media = self.contract["physical_media"]
        self.assertEqual(media["partition_count"], 2)
        self.assertEqual(
            [partition["name"] for partition in media["partitions"]],
            ["ORDAX-ESP", "ORDAX"],
        )
        self.assertFalse(media["separate_home_partition"])
        self.assertIn("ORDAX-HOME", media["forbidden_required_partitions"])
        self.assertIn("ORDAX-PLATFORM", media["forbidden_required_partitions"])

    def test_user_data_is_logical_inside_main_partition(self):
        layout = self.contract["logical_main_layout"]
        self.assertEqual(layout["home"], "/ordax/home")
        self.assertEqual(layout["state"], "/ordax/state")
        self.assertEqual(layout["releases"], "/ordax/releases")

    def test_release_model_is_commit_addressed_and_rollback_safe(self):
        release = self.contract["release_model"]
        self.assertEqual(release["addressing"], "source-commit")
        self.assertTrue(release["immutable_after_verification"])
        self.assertEqual(release["activation"], "atomic-current-pointer")
        self.assertTrue(release["rollback_required"])

    def test_surface_has_one_source_for_device_and_web(self):
        surface = self.contract["surface"]
        self.assertTrue(surface["single_source_tree_required"])
        self.assertFalse(surface["device_and_web_ui_forks_allowed"])
        self.assertTrue(surface["shared_components_required"])
        self.assertTrue(surface["shared_design_tokens_required"])
        self.assertTrue(surface["shared_application_source_required"])
        self.assertTrue(surface["platform_differences_via_adapters_only"])
        self.assertEqual(
            surface["targets"],
            ["ordax-device", "local-web", "hosted-web"],
        )
        self.assertTrue(surface["same_source_commit_for_equivalent_surface"])
        self.assertFalse(surface["manual_web_to_device_port_required"])

    def test_remote_access_is_fail_closed(self):
        security = self.contract["security"]
        self.assertTrue(security["ssh_public_key_only"])
        self.assertTrue(security["strict_host_key_checking_required"])
        self.assertTrue(security["persistent_device_host_key_required"])
        self.assertTrue(security["multiple_operator_public_keys_allowed"])
        self.assertFalse(security["private_keys_in_repository_allowed"])
        self.assertTrue(security["fail_closed_identity_and_integrity"])

    def test_daily_development_does_not_require_reflash(self):
        development = self.contract["development"]
        self.assertFalse(development["full_image_rebuild_per_edit"])
        self.assertFalse(development["usb_reflash_per_edit"])
        self.assertFalse(development["routine_reboot_per_edit"])
        self.assertTrue(development["delta_or_release_update_preferred"])
        self.assertTrue(development["browser_hmr_for_surface_allowed"])
        self.assertTrue(development["surface_change_should_reach_web_and_device"])


if __name__ == "__main__":
    unittest.main()
