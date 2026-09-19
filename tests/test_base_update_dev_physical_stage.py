#!/usr/bin/env python3
"""Boundary regressions for physical development Base staging."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "system/services/base-update/dev_physical_stage.py"
CONTRACT = json.loads(
    (ROOT / "docs/contracts/base-update.json").read_text(encoding="utf-8")
)


class PhysicalDevelopmentStageBoundaryTests(unittest.TestCase):
    def test_helper_is_stage_only_and_reuses_shared_stager(self):
        text = HELPER.read_text(encoding="utf-8")
        self.assertIn('HERE / "dev_stage.py"', text)
        self.assertIn("_dev_stage.stage_ready_candidate(", text)
        self.assertIn("_readonly.readonly_preflight(", text)
        self.assertIn("_discovery.discover_esp(", text)
        self.assertIn("_layout.inspect_layout(", text)
        self.assertIn('"rw,nosuid,nodev,noexec,umask=0022"', text)
        self.assertNotIn("activate.py", text)
        self.assertNotIn("promote.py", text)
        self.assertNotIn("LoaderEntryOneShot", text)
        self.assertNotIn("/sys/firmware/efi/efivars", text)
        self.assertNotIn("reboot -f", text)
        self.assertNotIn("busybox reboot", text)
        self.assertNotIn("power-request", text)

    def test_contract_keeps_runtime_wiring_disabled(self):
        stage = CONTRACT["runtime_owner"]["development_physical_stage"]
        self.assertEqual(
            stage["helper"],
            "system/services/base-update/dev_physical_stage.py",
        )
        self.assertEqual(
            stage["schema"],
            "prototype-ordax.dev-base-physical-stage/1",
        )
        self.assertTrue(stage["fresh_readonly_preflight_required_before_rw"])
        self.assertTrue(stage["same_parent_disk_revalidated_before_rw"])
        self.assertEqual(stage["rw_mount_filesystem"], "vfat")
        self.assertEqual(
            stage["rw_mount_options"],
            ["rw", "nosuid", "nodev", "noexec"],
        )
        self.assertTrue(stage["active_slot_derived_from_esp_layout"])
        self.assertTrue(stage["shared_ab_stager_only"])
        self.assertTrue(stage["inactive_slot_only"])
        self.assertTrue(stage["known_good_entries_unchanged"])
        self.assertTrue(stage["known_good_artifacts_unchanged"])
        self.assertTrue(stage["same_candidate_retry_idempotent"])
        self.assertTrue(stage["different_existing_candidate_blocks"])
        self.assertTrue(stage["mount_released_before_return"])
        self.assertFalse(stage["loader_entry_oneshot_written"])
        self.assertFalse(stage["efi_variables_written"])
        self.assertFalse(stage["reboot_requested"])
        self.assertFalse(stage["activation_performed"])
        self.assertFalse(stage["owner_runtime_wiring_enabled"])
        self.assertFalse(stage["physical_notebook_proven"])


if __name__ == "__main__":
    unittest.main()
