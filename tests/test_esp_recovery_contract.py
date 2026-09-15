#!/usr/bin/env python3
"""Regressions for the minimal ESP/recovery contract."""

import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ESP = ROOT / "boot" / "esp"
SOURCE = json.loads((ESP / "source.json").read_text(encoding="utf-8"))
INIT = (ROOT / "bootstrap" / "initramfs" / "root" / "init").read_text(encoding="utf-8")
RECOVERY = (ROOT / "bootstrap" / "recovery" / "entrypoint").read_text(encoding="utf-8")


class ESPContractTest(unittest.TestCase):
    def test_bootloader_source_is_pinned_to_verified_upstream_tag(self):
        boot = SOURCE["bootloader"]
        self.assertEqual(boot["project"], "systemd-boot")
        self.assertEqual(boot["version"], "261.2")
        self.assertEqual(boot["tag"], "v261.2")
        self.assertEqual(boot["tag_object_sha"], "d5e8f63a205ef22cb7e43a5ff2cc79556340ead0")
        self.assertEqual(boot["source_commit"], "4925d9f07fc697efccd98a93046ff535b8832445")
        self.assertTrue(boot["upstream_tag_signature_verified"])
        self.assertFalse(SOURCE["build"]["physical_artifact_authorized"])

    def test_esp_layout_is_minimal(self):
        self.assertEqual(
            SOURCE["target_layout"],
            [
                "EFI/BOOT/BOOTX64.EFI",
                "loader/loader.conf",
                "loader/entries/ordax.conf",
                "loader/entries/ordax-recovery.conf",
                "ordax/vmlinuz",
                "ordax/initrd.gz",
            ],
        )
        joined = "\n".join(SOURCE["target_layout"]).lower()
        for forbidden in ("developer", "maintenance", "installer"):
            self.assertNotIn(forbidden, joined)

    def test_loader_files_match_pinned_hashes(self):
        cfg = SOURCE["configuration"]
        pairs = (
            ("loader_conf", "loader_conf_sha256"),
            ("normal_entry", "normal_entry_sha256"),
            ("recovery_entry", "recovery_entry_sha256"),
        )
        for path_key, hash_key in pairs:
            path = ROOT / cfg[path_key]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), cfg[hash_key])

    def test_recovery_is_explicit_and_read_only(self):
        self.assertIn("ordax.mode=recovery", INIT)
        self.assertIn('mount -t ext4 -o ro "$ORDAX_DEVICE" /ordax', INIT)
        self.assertIn("/ordax/bootstrap/recovery/entrypoint", INIT)
        self.assertIn("mounted read-only", RECOVERY)
        self.assertNotIn("network", RECOVERY.lower().replace("no network", ""))

    def test_only_normal_and_recovery_loader_entries_exist(self):
        entries = ESP / "loader" / "entries"
        names = sorted(path.name for path in entries.glob("*.conf"))
        self.assertEqual(names, ["ordax-recovery.conf", "ordax.conf"])
        self.assertIn("ordax.mode=normal", (entries / "ordax.conf").read_text(encoding="utf-8"))
        self.assertIn("ordax.mode=recovery", (entries / "ordax-recovery.conf").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
