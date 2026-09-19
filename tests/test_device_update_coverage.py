import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "device-update-coverage.json"
PULL = ROOT / "bootstrap" / "dev-base" / "ordax-pull"
DEV_HELPERS = ROOT / "system" / "services" / "base-update" / "dev-helpers.sh"
DEV_CHANNEL = ROOT / "system" / "services" / "base-update" / "dev_channel.py"
MINIMAL = ROOT / "docs" / "contracts" / "minimal-bootstrap.json"
DEV_INIT = ROOT / "bootstrap" / "dev-base" / "ordax-dev-init"
NETWORK = ROOT / "bootstrap" / "dev-base" / "ordax-network"


class DeviceUpdateCoverageTests(unittest.TestCase):
    def test_git_is_source_authority_without_putting_network_on_boot_critical_path(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["$schema"],
            "prototype-ordax.device-update-coverage/1",
        )
        self.assertTrue(
            contract["source_authority"]["git_is_source_authority_for_all_product_layers"]
        )
        self.assertTrue(contract["boot_policy"]["known_good_local_boot_precedes_network"])
        self.assertFalse(contract["boot_policy"]["normal_boot_waits_for_git"])
        self.assertEqual(contract["boot_policy"]["surface_health_default_timeout_seconds"], 30)
        self.assertEqual(contract["boot_policy"]["surface_health_minimum_override_seconds"], 15)
        self.assertTrue(
            contract["boot_policy"]["recovery_must_not_wait_minutes_for_surface_health"]
        )
        self.assertTrue(contract["runtime_checkout"]["sparse_by_design"])
        self.assertTrue(contract["runtime_checkout"]["must_not_expand_to_full_repository_on_boot"])

    def test_known_good_local_boot_does_not_wait_for_network_driver_loading(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        init = DEV_INIT.read_text(encoding="utf-8")
        network = NETWORK.read_text(encoding="utf-8")

        self.assertFalse(
            contract["boot_policy"]["network_module_loading_on_known_good_local_boot"]
        )
        self.assertTrue(
            contract["boot_policy"]["network_initialization_runs_outside_local_boot_critical_path"]
        )
        self.assertEqual(
            contract["boot_policy"]["network_initialization_owner"],
            "bootstrap/dev-base/ordax-network",
        )
        self.assertNotIn('for module in iwlwifi rtl8xxxu mt76x2u ath9k_htc', init)
        self.assertIn('for module in iwlwifi rtl8xxxu mt76x2u ath9k_htc', network)
        self.assertIn("load_network_modules", network)
        self.assertIn("start_network_background", init)

    def test_runtime_pull_stays_lightweight_while_helpers_refresh_from_git(self):
        pull = PULL.read_text(encoding="utf-8")
        helpers = DEV_HELPERS.read_text(encoding="utf-8")

        self.assertIn("/system/", pull)
        self.assertIn("/bootstrap/base-update/", pull)
        self.assertIn("/bootstrap/dev-base/ordax-pull", pull)
        self.assertNotIn("/bootstrap/kernel/", pull)
        self.assertNotIn("/bootstrap/initramfs/", pull)
        self.assertNotIn("/tools/creator/", pull)

        for source in (
            "bootstrap/dev-base/ordax-dev-init",
            "bootstrap/dev-base/ordax-network",
            "bootstrap/dev-base/ordax-pull",
            "bootstrap/dev-base/ordax-rollback",
            "bootstrap/dev-base/ordax-run",
            "bootstrap/recovery/entrypoint",
        ):
            self.assertIn(source, helpers)

    def test_kernel_initramfs_and_rootfs_use_exact_commit_base_delivery_without_usb_rewrite(self):
        channel = DEV_CHANNEL.read_text(encoding="utf-8")
        self.assertIn('SCHEMA = "prototype-ordax.dev-base-candidate/3"', channel)
        self.assertIn('"kernel"', channel)
        self.assertIn('"initramfs"', channel)
        self.assertIn('"rootfs"', channel)
        self.assertIn('MAX_ROOTFS_BYTES', channel)
        self.assertIn('"inactive-slot-next-boot"', channel)
        self.assertIn('"manual_usb_rewrite_required"', channel)
        self.assertIn("is not False", channel)

        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        boot = next(item for item in contract["layers"] if item["id"] == "kernel-and-initramfs")
        self.assertEqual(boot["development_delivery"], "exact-commit-development-base-candidate")
        self.assertFalse(boot["usb_rewrite_required"])
        self.assertTrue(boot["reboot_required"])

        rootfs = next(item for item in contract["layers"] if item["id"] == "development-rootfs")
        self.assertEqual(
            rootfs["development_delivery"],
            "exact-commit-development-base-rootfs-candidate",
        )
        self.assertTrue(rootfs["candidate_delivery_implemented"])
        self.assertFalse(rootfs["activation_implemented"])
        self.assertTrue(rootfs["selector_implemented"])
        self.assertFalse(rootfs["usb_rewrite_required"])
        self.assertTrue(rootfs["reboot_required"])
        activation = contract["development_rootfs_activation"]
        self.assertEqual(activation["artifact"], "rootfs.tar")
        self.assertEqual(activation["current_boot_root"], "/ordax/dev-base")
        self.assertIn("/ordax/dev-base/versions/<commit>", activation["target_versioned_layout"])
        self.assertEqual(
            activation["selector_owner"],
            "bootstrap/dev-base/ordax-dev-init",
        )
        self.assertIn("ordax.base_candidate", activation["candidate_identity"])
        self.assertIn("base heartbeat + Surface health", activation["promotion_policy"])
        self.assertIn("A/B boot slot", activation["next_gate"])
        self.assertIn("not yet consumed", activation["current_limit"])

        init = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn("select_development_rootfs()", init)
        self.assertIn("activate_versioned_rootfs()", init)
        self.assertIn("ordax.base_candidate", init)
        self.assertIn("ordax.base_slot", init)
        self.assertIn("ROOTFS_SELECTION_DIR=$STATE_DIR/base-update/rootfs", init)
        self.assertIn('/bin/busybox pivot_root . .ordax-base', init)
        self.assertIn('write_rootfs_slot_mapping "$base_slot" "$candidate_sha"', init)
        self.assertIn("preservando Base seed conhecida como boa", init)

    def test_uefi_loader_is_repository_owned_but_gap_is_not_hidden(self):
        minimal = json.loads(MINIMAL.read_text(encoding="utf-8"))
        groups = {item["id"]: item for item in minimal["artifact_groups"]}
        uefi = groups["uefi-boot"]["artifacts"]
        self.assertTrue(
            any(item["target_path"] == "/EFI/BOOT/BOOTX64.EFI" for item in uefi)
        )

        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        loader = next(item for item in contract["layers"] if item["id"] == "uefi-fallback-loader")
        self.assertTrue(loader["self_update_gap"])
        self.assertEqual(
            loader["usb_rewrite_required"],
            "currently-yes-for-loader-byte-change",
        )
        self.assertEqual(
            contract["known_gap"]["id"],
            "uefi-fallback-loader-self-update",
        )
        self.assertFalse(contract["known_gap"]["normal_system_update_blocked_by_gap"])

    def test_boot_branding_status_is_explicit(self):
        dev_init = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn("OrdaX Development Base", dev_init)
        self.assertIn("Iniciando OrdaX...", dev_init)

        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        branding = contract["branding"]
        self.assertEqual(branding["current_pre_surface_boot_ui"], "console-text")
        self.assertFalse(branding["graphical_boot_splash_implemented"])
        self.assertTrue(branding["branding_source_must_remain_repository_owned"])


if __name__ == "__main__":
    unittest.main()
