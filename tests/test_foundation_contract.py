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

    def test_contract_schema_is_current(self):
        self.assertEqual(self.contract["$schema"], "prototype-ordax.foundation/6")

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

    def test_initial_usb_is_minimum_release_acquisition_first(self):
        seed = self.contract["initial_media"]
        self.assertEqual(seed["policy"], "minimum-release-acquisition-first")
        self.assertFalse(seed["full_system_preseeded"])
        self.assertFalse(seed["surface_preseeded"])
        self.assertFalse(seed["normal_apps_preseeded"])
        self.assertFalse(seed["remote_core_preseeded"])
        self.assertFalse(seed["control_plane_preseeded"])
        self.assertFalse(seed["stable_device_identity_preseeded"])
        self.assertFalse(seed["full_git_client_preseeded"])
        self.assertFalse(seed["legacy_repository_dump_allowed"])
        self.assertFalse(seed["build_toolchain_preseeded"])
        self.assertFalse(seed["complete_source_checkout_preseeded"])
        self.assertTrue(seed["first_full_release_acquired_after_boot"])
        self.assertTrue(seed["bootstrap_manifest_required_before_physical_write"])
        self.assertTrue(seed["known_good_release_persisted_after_first_activation"])
        self.assertTrue(seed["known_good_offline_boot_required"])
        self.assertFalse(seed["normal_system_changes_require_usb_reflash"])
        self.assertNotIn("ordax-remote-core", seed["allowed_initial_payload_classes"])
        self.assertNotIn("minimal-control-plane", seed["allowed_initial_payload_classes"])
        self.assertIn("https-release-acquisition", seed["allowed_initial_payload_classes"])

    def test_pre_release_path_contains_only_boot_network_release_and_recovery(self):
        self.assertEqual(
            self.contract["pre_release_capabilities"],
            [
                "uefi-boot",
                "kernel",
                "initramfs",
                "minimal-network",
                "release-acquisition",
                "recovery-maintenance",
            ],
        )
        optional = self.contract["post_release_optional_capabilities"]
        self.assertIn("stable-device-identity", optional)
        self.assertIn("ordax-remote-core", optional)
        self.assertIn("control-plane", optional)

    def test_user_data_is_logical_inside_main_partition(self):
        layout = self.contract["logical_main_layout"]
        self.assertEqual(layout["home"], "/ordax/home")
        self.assertEqual(layout["state"], "/ordax/state")
        self.assertEqual(layout["releases"], "/ordax/releases")

    def test_release_model_is_commit_addressed_and_compiler_free_on_device(self):
        release = self.contract["release_model"]
        self.assertEqual(release["addressing"], "source-commit")
        self.assertTrue(release["immutable_after_verification"])
        self.assertEqual(release["activation"], "atomic-current-pointer")
        self.assertTrue(release["rollback_required"])
        self.assertFalse(release["device_full_git_client_required"])
        self.assertFalse(release["device_source_checkout_required"])
        self.assertFalse(release["device_compiler_required"])
        self.assertFalse(release["remote_shell_required"])

    def test_four_modes_are_one_product(self):
        modes = self.contract["product_modes"]
        self.assertTrue(modes["single_product"])
        self.assertEqual(modes["modes"], ["web", "desktop", "usb", "native-disk"])
        self.assertEqual(modes["capability_progression"], ["web", "desktop", "usb", "native-disk"])
        self.assertTrue(modes["same_account_model"])
        self.assertTrue(modes["same_surface_source"])
        self.assertTrue(modes["same_application_source"])
        self.assertTrue(modes["web_is_first_class_mode"])
        self.assertTrue(modes["desktop_is_first_class_mode"])

    def test_desktop_is_intermediate_mode_with_narrow_privilege_boundary(self):
        desktop = self.contract["desktop"]
        self.assertEqual(desktop["first_host"], "windows")
        self.assertTrue(desktop["normal_user_install"])
        self.assertFalse(desktop["is_ordax_operating_system"])
        self.assertTrue(desktop["shared_surface_required"])
        self.assertTrue(desktop["signed_updates_required"])
        self.assertTrue(desktop["usb_creator_capability"])
        self.assertFalse(desktop["raw_host_disk_access_by_default"])
        self.assertTrue(desktop["privileged_helper_only_when_required"])
        self.assertFalse(desktop["arbitrary_privileged_command_api_allowed"])
        self.assertTrue(desktop["desktop_update_and_os_release_channels_separate"])

    def test_surface_has_one_source_for_every_product_mode(self):
        surface = self.contract["surface"]
        self.assertTrue(surface["single_source_tree_required"])
        self.assertFalse(surface["device_and_web_ui_forks_allowed"])
        self.assertTrue(surface["shared_components_required"])
        self.assertTrue(surface["shared_design_tokens_required"])
        self.assertTrue(surface["shared_application_source_required"])
        self.assertTrue(surface["platform_differences_via_adapters_only"])
        self.assertEqual(
            surface["targets"],
            ["ordax-device", "desktop-host", "local-web", "hosted-web"],
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
        self.assertTrue(host["creator_is_desktop_capability"])
        self.assertTrue(host["thin_platform_adapters_allowed"])
        self.assertFalse(host["platform_policy_forks_allowed"])
        self.assertFalse(host["end_user_kernel_toolchain_required"])

    def test_remote_control_is_optional_and_ssh_is_not_required(self):
        remote = self.contract["remote_control"]
        self.assertFalse(remote["required_for_bootstrap"])
        self.assertFalse(remote["required_for_product"])
        self.assertFalse(remote["required_for_daily_development"])
        self.assertFalse(remote["ssh_required"])
        self.assertTrue(remote["product_owned_remote_core_may_be_added_later"])
        self.assertFalse(remote["custom_cryptographic_primitives_allowed"])

    def test_security_stays_fail_closed_without_custom_crypto(self):
        security = self.contract["security"]
        self.assertFalse(security["private_keys_in_repository_allowed"])
        self.assertTrue(security["fail_closed_identity_and_integrity"])
        self.assertFalse(security["custom_crypto_allowed"])

    def test_daily_development_is_git_driven_without_remote_shell(self):
        development = self.contract["development"]
        self.assertEqual(development["normal_change_path"], "git-push-to-ci-release-update")
        self.assertFalse(development["full_image_rebuild_per_edit"])
        self.assertFalse(development["usb_reflash_per_edit"])
        self.assertFalse(development["routine_reboot_per_edit"])
        self.assertTrue(development["delta_or_release_update_preferred"])
        self.assertTrue(development["browser_hmr_for_surface_allowed"])
        self.assertTrue(development["surface_change_should_reach_web_desktop_and_device"])
        self.assertFalse(development["remote_shell_required"])
        self.assertFalse(development["remote_control_service_required"])
        self.assertFalse(development["emulator_mandatory"])
        self.assertTrue(development["real_hardware_validation_required_before_final_promotion"])


if __name__ == "__main__":
    unittest.main()
