#!/usr/bin/env python3
"""Regressions for the pure OrdaX base update planner."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap" / "base-update" / "plan.py"
spec = importlib.util.spec_from_file_location("ordax_base_update_plan_test", MODULE_PATH)
planner = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(planner)


class BaseUpdatePlannerTests(unittest.TestCase):
    def candidate(self):
        return {
            "release_sha": "a" * 40,
            "kernel_sha256": "b" * 64,
            "initramfs_sha256": "c" * 64,
        }

    def test_a_stages_only_to_b_and_preserves_a_for_failure(self):
        value = planner.plan("a", self.candidate())
        self.assertEqual(value["candidate_slot"], "b")
        self.assertEqual(value["stage"]["kernel"]["target_path"], "/ordax/base/b/vmlinuz")
        self.assertEqual(value["stage"]["initramfs"]["target_path"], "/ordax/base/b/initrd.gz")
        self.assertEqual(value["failure"]["current_slot"], "a")
        self.assertTrue(value["failure"]["candidate_never_promoted"])

    def test_b_stages_only_to_a_and_keeps_b_as_recovery_after_success(self):
        value = planner.plan("b", self.candidate())
        self.assertEqual(value["candidate_slot"], "a")
        self.assertEqual(value["promotion"]["current_slot_after_health"], "a")
        self.assertEqual(value["promotion"]["recovery_slot_after_health"], "b")

    def test_activation_is_one_shot_and_never_changes_default_before_health(self):
        value = planner.plan("a", self.candidate())
        self.assertEqual(value["activation"]["selector"], "LoaderEntryOneShot")
        self.assertEqual(value["activation"]["entry_id"], "ordax-candidate")
        self.assertEqual(value["activation"]["tries"], 1)
        self.assertFalse(value["activation"]["default_entry_changes_before_health"])
        self.assertEqual(
            value["stage"]["candidate_entry"],
            "/loader/entries/ordax-candidate+01-00.conf",
        )

    def test_candidate_cmdline_binds_slot_and_release(self):
        value = planner.plan("a", self.candidate())
        self.assertIn("ordax.base_slot=b", value["stage"]["kernel_options"])
        self.assertIn("ordax.base_candidate=" + "a" * 40, value["stage"]["kernel_options"])

    def test_invalid_active_slot_and_digests_fail_closed(self):
        with self.assertRaises(planner.PlanError):
            planner.plan("current", self.candidate())
        broken = self.candidate()
        broken["kernel_sha256"] = "bad"
        with self.assertRaises(planner.PlanError):
            planner.plan("a", broken)
        unexpected = {**self.candidate(), "path": "/tmp/kernel"}
        with self.assertRaises(planner.PlanError):
            planner.plan("a", unexpected)


if __name__ == "__main__":
    unittest.main()
