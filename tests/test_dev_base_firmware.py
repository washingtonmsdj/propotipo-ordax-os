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

    def test_build_only_runtime_pruning_removes_metadata_and_zstd(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            for relative in BUILD.RUNTIME_PRUNE_PATHS:
                path = rootfs / relative
                if Path(relative).suffix:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("metadata", encoding="utf-8")
                else:
                    path.mkdir(parents=True, exist_ok=True)
                    (path / "placeholder").write_text("metadata", encoding="utf-8")

            zstd = rootfs / "usr/bin/zstd"
            zstd.parent.mkdir(parents=True, exist_ok=True)
            zstd.write_text("binary", encoding="utf-8")

            commands = []
            original_proot = BUILD.CORE.proot_rootfs

            def fake_proot(_rootfs, command):
                commands.append(command)
                zstd.unlink(missing_ok=True)

            BUILD.CORE.proot_rootfs = fake_proot
            try:
                BUILD.prune_build_only_runtime(rootfs)
            finally:
                BUILD.CORE.proot_rootfs = original_proot

            self.assertEqual(commands, ["apk del --no-cache zstd"])
            self.assertFalse(zstd.exists())
            for relative in BUILD.RUNTIME_PRUNE_PATHS:
                self.assertFalse((rootfs / relative).exists())

    def test_zstd_is_build_only_not_runtime_capability(self):
        self.assertIn("zstd", BUILD.PACKAGES)
        self.assertEqual(BUILD.BUILD_ONLY_PACKAGES, ("zstd",))

    def test_graphical_surface_runtime_is_seeded(self):
        for package in (
            "cage",
            "cog",
            "seatd-launch",
            "mesa-dri-gallium",
            "mesa-egl",
            "mesa-gbm",
            "font-dejavu",
        ):
            self.assertIn(package, BUILD.PACKAGES)
        self.assertEqual(BUILD.MAX_ROOTFS_BYTES, 512 * 1024 * 1024)

    def test_unrelated_firmware_packages_are_not_seeded(self):
        for package in (
            "linux-firmware-brcm",
            "linux-firmware-rtl_nic",
            "linux-firmware-realtek",
        ):
            self.assertNotIn(package, BUILD.PACKAGES)


if __name__ == "__main__":
    unittest.main()
