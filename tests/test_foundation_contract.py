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

    def test_three_modes_are_one_product(self):
        modes = self.contract["product_modes"]
        self.assertTrue(modes["single_product"])
        self.assertEqual(modes["modes"], ["web", "usb", "native-disk"])
        self.assertTrue(modes["same_account_model"])
        self.assertTrue(modes["same_surface_source"])
        self.assertTrue(modes["same_application_source"])
        self.assertTrue(modes["web_is_first_class_mode"])

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

    def test_host_tools_do_not_require_wsl_qemu_or_shell(self):
        host = self.contract["host_independence"]
        self.assertFalse(host["wsl_required"])
        self.assertFalse(host["qemu_required"])
        self.assertFalse(host["powershell_required"])
        self.assertFalse(host["bash_required"])
        self.assertFalse(host["specific_linux_distribution_required"])
        self.assertFalse(host["specific_desktop_os_required"])
        self.assertTrue(host["shared_creator_core_required"])
        self.assertTrue(host["thin_platform_adapters_allowed"])
        self.assertFalse(host["platform_policy_forks_allowed"])
        self.assertFalse(host["end_user_kernel_toolchain_required"])

    def test_ordax_remote_core_replaces_required_ssh_dependency(self):
        remote = self.contract["remote_control"]
        self.assertTrue(remote["product_owned_remote_core_required"])
        self.assertFalse(remote["external_ssh_executable_required"])
        self.assertFalse(remote["ssh_required_for_product"])
        self.assertFalse(remote["ssh_required_for_daily_development"])
        self.assertTrue(remote["structured_capability_rpc_preferred"])
        self.assertFalse(remote["arbitrary_shell_is_primary_control_path"])
        self.assertTrue(remote["browser_compatible_transport_desired"])
        self.assertFalse(remote["custom_cryptographic_primitives_allowed"])
        self.assertTrue(remote["mature_secure_transport_required"])
        self.assertTrue(remote["device_private_identity_stays_local"])
        self.assertIn("ordax-remote-core", self.contract["pre_git_capabilities"])
        self.assertNotIn("remote-core-ssh", self.contract["pre_git_capabilities"])

    def test_security_stays_fail_closed_without_custom_crypto(self):
        security = self.contract["security"]
        self.assertFalse(security["private_keys_in_repository_allowed"])
        self.assertTrue(security["fail_closed_identity_and_integrity"])
        self.assertTrue(security["device_identity_persistent"])
        self.assertTrue(security["multiple_operator_authorizations_allowed"])
        self.assertFalse(security["custom_crypto_allowed"])

    def test_daily_development_does_not_require_reflash_or_emulator(self):
        development = self.contract["development"]
        self.assertFalse(development["full_image_rebuild_per_edit"])
        self.assertFalse(development["usb_reflash_per_edit"])
        self.assertFalse(development["routine_reboot_per_edit"])
        self.assertTrue(development["delta_or_release_update_preferred"])
        self.assertTrue(development["browser_hmr_for_surface_allowed"])
        self.assertTrue(development["surface_change_should_reach_web_and_device"])
        self.assertFalse(development["emulator_mandatory"])
        self.assertTrue(development["real_hardware_validation_required_before_final_promotion"])


if __name__ == "__main__":
    unittest.main()
