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
    def test_available_alternative_is_selected_when_historical_name_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            modules = rootfs / "lib/modules/6.6.52/kernel/drivers/net/wireless"
            firmware = rootfs / "lib/firmware"
            modules.mkdir(parents=True)
            firmware.mkdir(parents=True)
            (modules / "wifi.ko").write_bytes(
                b"ELF\x00firmware=wifi-old.ucode\x00"
                b"firmware=wifi-current.ucode\x00"
            )
            (firmware / "wifi-current.ucode").write_bytes(b"current")

            self.assertEqual(
                BUILD.required_firmware_names(rootfs),
                {"wifi-current.ucode"},
            )

    def test_module_with_no_available_declared_firmware_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            modules = rootfs / "lib/modules/6.6.52/kernel/drivers/net/wireless"
            firmware = rootfs / "lib/firmware"
            modules.mkdir(parents=True)
            firmware.mkdir(parents=True)
            (modules / "wifi.ko").write_bytes(
                b"ELF\x00firmware=wifi-old.ucode\x00"
                b"firmware=wifi-other.ucode\x00"
            )

            with self.assertRaises(BUILD.BuildError):
                BUILD.required_firmware_names(rootfs)

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

            original_proot = BUILD.CORE.proot_rootfs
            BUILD.CORE.proot_rootfs = lambda _rootfs, _command: None
            try:
                BUILD.prune_firmware(rootfs, {"rtlwifi/alias.bin"})
            finally:
                BUILD.CORE.proot_rootfs = original_proot

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
