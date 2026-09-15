#!/usr/bin/env python3
"""Regression tests for the clean-room kernel source/config contract."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
FRAGMENT = (ROOT / SOURCE["configuration"]["fragment"]).read_text(encoding="utf-8")


class KernelSourceContractTest(unittest.TestCase):
    def test_linux_source_identity_is_pinned(self):
        self.assertEqual(SOURCE["version"], "6.6.52")
        self.assertEqual(
            SOURCE["archive_sha256"],
            "1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8",
        )
        self.assertTrue(SOURCE["archive_url"].startswith("https://cdn.kernel.org/"))

    def test_clean_fragment_has_no_old_layout_or_forge_language(self):
        for forbidden in (
            "ORDAX-PLATFORM",
            "ORDAX-HOME",
            "MISSION-",
            "Milestone",
            "Forge",
        ):
            self.assertNotIn(forbidden, FRAGMENT)

    def test_rejected_legacy_kconfig_spellings_cannot_return(self):
        self.assertNotIn("CONFIG_MT76=m", FRAGMENT)
        self.assertNotIn("CONFIG_FB_SIMPLE=y", FRAGMENT)
        self.assertNotIn("CONFIG_FIRMWARE_LOADER=y", FRAGMENT)

    def test_required_resolved_selectors_use_linux_6_6_names(self):
        for required in (
            "CONFIG_EFI_STUB=y",
            "CONFIG_SYSFB_SIMPLEFB=y",
            "CONFIG_FW_LOADER=y",
            "CONFIG_WLAN_VENDOR_MEDIATEK=y",
            "CONFIG_MT76x2U=m",
            "CONFIG_IWLWIFI=m",
            "CONFIG_EXT4_FS=y",
            "CONFIG_VFAT_FS=y",
        ):
            self.assertIn(required, FRAGMENT)

    def test_kernel_is_not_authorized_for_physical_media_yet(self):
        self.assertFalse(SOURCE["build"]["pinned_environment_resolved"])
        self.assertFalse(SOURCE["build"]["physical_artifact_authorized"])


if __name__ == "__main__":
    unittest.main()
