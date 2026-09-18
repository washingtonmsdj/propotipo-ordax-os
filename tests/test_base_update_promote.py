#!/usr/bin/env python3
"""Regressions for boot-bound OrdaX base health and A/B promotion."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap" / "base-update" / "promote.py"
spec = importlib.util.spec_from_file_location("ordax_base_update_promote_test", MODULE_PATH)
promote = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(promote)


class BaseUpdatePromotionTests(unittest.TestCase):
    RELEASE = "a" * 40
    BOOT_ID = "0123456789abcdef0123456789abcdef"

    def evidence(self):
        return {
            "cmdline": (
                "console=tty0 ordax.mode=normal ordax.base_slot=b "
                f"ordax.base_candidate={self.RELEASE}"
            ),
            "boot_id": self.BOOT_ID,
            "source_sha": self.RELEASE,
            "healthy_sha": self.RELEASE,
            "base_heartbeat": {
                "$schema": "prototype-ordax.base-heartbeat/1",
                "candidateSha": self.RELEASE,
                "sourceSha": self.RELEASE,
                "slot": "b",
                "bootId": self.BOOT_ID,
            },
            "surface_heartbeat": {
                "sourceSha": self.RELEASE,
                "bootId": self.BOOT_ID,
                "observedEpoch": 1,
            },
            "expected_release_sha": self.RELEASE,
            "expected_candidate_slot": "b",
            "previous_slot": "a",
        }

    def fixture(self, root: Path):
        esp = root / "esp"
        state = root / "state"
        entries = esp / "loader" / "entries"
        entries.mkdir(parents=True)
        state.mkdir()
        (state / "boot-refresh-required").write_text(self.RELEASE + "\n", encoding="utf-8")
        for slot in ("a", "b"):
            base = esp / "ordax" / "base" / slot
            base.mkdir(parents=True)
            (base / "vmlinuz").write_bytes(f"kernel-{slot}".encode())
            (base / "initrd.gz").write_bytes(f"initrd-{slot}".encode())

        current = entries / "ordax.conf"
        recovery = entries / "ordax-recovery.conf"
        candidate = entries / "ordax-candidate+00-01.conf"
        current.write_text(
            "title OrdaX\n"
            "linux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=normal ordax.base_slot=a\n",
            encoding="utf-8",
        )
        recovery.write_text(
            "title OrdaX Recovery\n"
            "linux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=recovery ordax.base_slot=a\n",
            encoding="utf-8",
        )
        candidate.write_text(
            "title OrdaX Candidate\n"
            "linux /ordax/base/b/vmlinuz\n"
            "initrd /ordax/base/b/initrd.gz\n"
            f"options console=tty0 ordax.mode=normal ordax.base_slot=b ordax.base_candidate={self.RELEASE}\n",
            encoding="utf-8",
        )
        return esp, state, current, recovery, candidate

    def test_all_boot_local_health_signals_must_agree(self):
        health = promote.evaluate_health(**self.evidence())
        self.assertTrue(health["healthy"])
        self.assertEqual(health["candidate_slot"], "b")
        self.assertEqual(health["previous_slot"], "a")
        self.assertTrue(all(health["checks"].values()))

    def test_any_release_or_boot_mismatch_fails_closed(self):
        mutations = [
            ("source_sha", "b" * 40),
            ("healthy_sha", "b" * 40),
            ("boot_id", "fedcba9876543210fedcba9876543210"),
            ("expected_candidate_slot", "a"),
        ]
        for key, value in mutations:
            with self.subTest(key=key):
                evidence = self.evidence()
                evidence[key] = value
                with self.assertRaises(promote.PromotionError):
                    promote.evaluate_health(**evidence)

        evidence = self.evidence()
        evidence["base_heartbeat"] = dict(evidence["base_heartbeat"], bootId="fedcba9876543210fedcba9876543210")
        with self.assertRaises(promote.PromotionError):
            promote.evaluate_health(**evidence)

        evidence = self.evidence()
        evidence["surface_heartbeat"] = dict(evidence["surface_heartbeat"], sourceSha="b" * 40)
        with self.assertRaises(promote.PromotionError):
            promote.evaluate_health(**evidence)

    def test_duplicate_candidate_cmdline_identity_is_rejected(self):
        evidence = self.evidence()
        evidence["cmdline"] += " ordax.base_slot=b"
        with self.assertRaises(promote.PromotionError):
            promote.evaluate_health(**evidence)

    def test_healthy_candidate_promotes_current_and_preserves_previous_as_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, state, current, recovery, candidate = self.fixture(root)
            health = promote.evaluate_health(**self.evidence())

            result = promote.promote(esp_root=esp, state_root=state, health=health)

            self.assertTrue(result["promoted"])
            self.assertEqual(result["active_slot"], "b")
            self.assertEqual(result["recovery_slot"], "a")
            self.assertFalse(candidate.exists())
            self.assertTrue(result["candidate_entry_removed"])
            self.assertTrue(result["current_entry_durable"])
            self.assertTrue(result["active_slot_record_written"])
            self.assertEqual(result["boot_refresh_marker_status"], "cleared")
            self.assertTrue(result["boot_refresh_marker_cleared"])
            self.assertFalse((state / "boot-refresh-required").exists())
            current_text = current.read_text(encoding="utf-8")
            recovery_text = recovery.read_text(encoding="utf-8")
            self.assertIn("linux /ordax/base/b/vmlinuz", current_text)
            self.assertIn("ordax.mode=normal ordax.base_slot=b", current_text)
            self.assertIn("linux /ordax/base/a/vmlinuz", recovery_text)
            self.assertIn("ordax.mode=recovery ordax.base_slot=a", recovery_text)

            active = json.loads((state / "base/active-slot.json").read_text(encoding="utf-8"))
            self.assertEqual(
                active,
                {
                    "$schema": "prototype-ordax.base-active-slot/1",
                    "activeSlot": "b",
                    "bootId": self.BOOT_ID,
                    "recoverySlot": "a",
                    "releaseSha": self.RELEASE,
                },
            )

    def test_promotion_rejects_unhealthy_or_mismatched_candidate_before_entry_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, state, current, recovery, candidate = self.fixture(root)
            before = (current.read_bytes(), recovery.read_bytes(), candidate.read_bytes())

            with self.assertRaises(promote.PromotionError):
                promote.promote(
                    esp_root=esp,
                    state_root=state,
                    health={
                        "$schema": "prototype-ordax.base-update-health/1",
                        "healthy": False,
                    },
                )
            self.assertEqual(
                (current.read_bytes(), recovery.read_bytes(), candidate.read_bytes()),
                before,
            )

            health = promote.evaluate_health(**self.evidence())
            candidate.write_text(
                candidate.read_text(encoding="utf-8").replace(
                    "ordax.base_candidate=" + self.RELEASE,
                    "ordax.base_candidate=" + "b" * 40,
                ),
                encoding="utf-8",
            )
            before = (current.read_bytes(), recovery.read_bytes())
            with self.assertRaises((promote.PromotionError, promote._activate.ActivateError)):
                promote.promote(esp_root=esp, state_root=state, health=health)
            self.assertEqual((current.read_bytes(), recovery.read_bytes()), before)

    def test_current_commit_reports_durability_uncertainty_after_replace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, _state, current, _recovery, _candidate = self.fixture(root)
            payload = promote.entry_payload("OrdaX", "b", "normal")

            with mock.patch.object(promote, "fsync_directory", side_effect=OSError("fsync unavailable")):
                durable = promote.commit_current_entry(esp, payload)

            self.assertFalse(durable)
            self.assertEqual(current.read_bytes(), payload)

    def test_unsafe_boot_refresh_marker_is_never_followed_or_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, state, _current, _recovery, _candidate = self.fixture(root)
            marker = state / "boot-refresh-required"
            outside = root / "outside-marker"
            outside.write_text("do-not-touch\n", encoding="utf-8")
            marker.unlink()
            marker.symlink_to(outside)
            health = promote.evaluate_health(**self.evidence())

            result = promote.promote(esp_root=esp, state_root=state, health=health)

            self.assertTrue(result["promoted"])
            self.assertEqual(result["boot_refresh_marker_status"], "unsafe")
            self.assertFalse(result["boot_refresh_marker_cleared"])
            self.assertTrue(marker.is_symlink())
            self.assertEqual(outside.read_text(encoding="utf-8"), "do-not-touch\n")

    def test_candidate_cleanup_precedes_current_commit_point(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        block = source.split("def promote(", 1)[1].split("\n\ndef main()", 1)[0]
        self.assertLess(block.index("candidate.unlink()"), block.index("commit_current_entry("))
        self.assertLess(block.index("prepare_active_record("), block.index("candidate.unlink()"))
        self.assertGreater(block.index("clear_boot_refresh_marker("), block.index("commit_current_entry("))

    def test_symlinked_protected_or_candidate_entries_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, state, current, recovery, candidate = self.fixture(root)
            health = promote.evaluate_health(**self.evidence())
            outside = root / "outside"
            outside.write_text(current.read_text(encoding="utf-8"), encoding="utf-8")
            current.unlink()
            current.symlink_to(outside)
            with self.assertRaises(promote.PromotionError):
                promote.promote(esp_root=esp, state_root=state, health=health)
            self.assertTrue(candidate.exists())


if __name__ == "__main__":
    unittest.main()
