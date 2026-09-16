#!/usr/bin/env python3
"""Regression tests for the Git-first development firmware seed."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "bootstrap/dev-base/build.py"
SPEC = importlib.util.spec_from_file_location("ordax_dev_base_build", BUILD_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load development base builder")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class DevelopmentFirmwareTest(unittest.TestCase):
    def test_required_firmware_names_are_read_from_selected_modules(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            modules = rootfs / "lib/modules/6.6.52/kernel/drivers/net/wireless"
            modules.mkdir(parents=True)
            (modules / "wifi.ko").write_bytes(
                b"ELF\x00firmware=iwlwifi-test.ucode\x00"
                b"firmware=rtlwifi/rtl-test.bin\x00"
            )
            self.assertEqual(
                BUILD.required_firmware_names(rootfs),
                {"iwlwifi-test.ucode", "rtlwifi/rtl-test.bin"},
            )

    def test_pruning_materializes_required_alias_and_drops_unrelated_firmware(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            firmware = rootfs / "lib/firmware"
            (firmware / "rtlwifi").mkdir(parents=True)
            (firmware / "brcm").mkdir(parents=True)
            target = firmware / "rtlwifi/target.bin"
            target.write_bytes(b"required")
            alias = firmware / "rtlwifi/alias.bin"
            alias.symlink_to("target.bin")
            (firmware / "brcm/unrelated.bin").write_bytes(b"unrelated")

            original_proot = BUILD.proot_rootfs
            BUILD.proot_rootfs = lambda _rootfs, _command: None
            try:
                BUILD.prune_firmware(rootfs, {"rtlwifi/alias.bin"})
            finally:
                BUILD.proot_rootfs = original_proot

            self.assertTrue(alias.is_file())
            self.assertFalse(alias.is_symlink())
            self.assertEqual(alias.read_bytes(), b"required")
            self.assertFalse((firmware / "brcm/unrelated.bin").exists())
            self.assertFalse(target.exists())

    def test_unrelated_firmware_packages_are_not_seeded(self):
        for package in (
            "linux-firmware-brcm",
            "linux-firmware-rtl_nic",
            "linux-firmware-realtek",
        ):
            self.assertNotIn(package, BUILD.PACKAGES)
        self.assertEqual(BUILD.MAX_ROOTFS_BYTES, 220 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
