#!/usr/bin/env python3
"""Regressions for fail-closed one-shot OrdaX base activation."""

import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap" / "base-update" / "activate.py"
spec = importlib.util.spec_from_file_location("ordax_base_update_activate_test", MODULE_PATH)
activate = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(activate)


class BaseUpdateActivateTests(unittest.TestCase):
    def fixture(self, root: Path):
        esp = root / "esp"
        efivars = root / "efivars"
        entries = esp / "loader" / "entries"
        slot = esp / "ordax" / "base" / "b"
        entries.mkdir(parents=True)
        slot.mkdir(parents=True)
        efivars.mkdir()

        current = entries / "ordax.conf"
        recovery = entries / "ordax-recovery.conf"
        candidate = entries / "ordax-candidate+01-00.conf"
        current.write_text("title OrdaX Current\nlinux /ordax/base/a/vmlinuz\n", encoding="utf-8")
        recovery.write_text("title OrdaX Recovery\nlinux /ordax/base/a/vmlinuz\n", encoding="utf-8")
        (slot / "vmlinuz").write_bytes(b"candidate kernel")
        (slot / "initrd.gz").write_bytes(b"candidate initramfs")
        release_sha = "a" * 40
        candidate.write_text(
            "title OrdaX Candidate\n"
            "linux /ordax/base/b/vmlinuz\n"
            "initrd /ordax/base/b/initrd.gz\n"
            f"options console=tty0 ordax.mode=normal ordax.base_slot=b ordax.base_candidate={release_sha}\n",
            encoding="utf-8",
        )
        return esp, efivars, release_sha

    def test_arm_writes_only_loader_entry_oneshot_and_preserves_known_good_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, efivars, release_sha = self.fixture(root)
            current = esp / "loader/entries/ordax.conf"
            recovery = esp / "loader/entries/ordax-recovery.conf"
            before = (current.read_bytes(), recovery.read_bytes())

            result = activate.arm(esp, efivars, release_sha, "b")

            self.assertTrue(result["armed"])
            self.assertFalse(result["default_entry_changed"])
            self.assertFalse(result["reboot_requested"])
            self.assertEqual(result["entry_id"], "ordax-candidate.conf")
            self.assertEqual((current.read_bytes(), recovery.read_bytes()), before)

            variable = efivars / activate.VARIABLE_NAME
            payload = variable.read_bytes()
            self.assertEqual(struct.unpack("<I", payload[:4])[0], 0x7)
            self.assertEqual(
                payload[4:].decode("utf-16-le"),
                "ordax-candidate.conf\x00",
            )

    def test_candidate_identity_must_match_release_and_inactive_slot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, efivars, release_sha = self.fixture(root)
            candidate = esp / "loader/entries/ordax-candidate+01-00.conf"

            candidate.write_text(
                candidate.read_text(encoding="utf-8").replace(
                    "ordax.base_slot=b", "ordax.base_slot=a"
                ),
                encoding="utf-8",
            )
            with self.assertRaises(activate.ActivateError):
                activate.arm(esp, efivars, release_sha, "b")
            self.assertFalse((efivars / activate.VARIABLE_NAME).exists())

    def test_missing_candidate_artifact_fails_before_efi_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, efivars, release_sha = self.fixture(root)
            (esp / "ordax/base/b/vmlinuz").unlink()

            with self.assertRaises(activate.ActivateError):
                activate.arm(esp, efivars, release_sha, "b")
            self.assertFalse((efivars / activate.VARIABLE_NAME).exists())

    def test_symlinked_candidate_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, efivars, release_sha = self.fixture(root)
            candidate = esp / "loader/entries/ordax-candidate+01-00.conf"
            target = root / "outside.conf"
            target.write_text(candidate.read_text(encoding="utf-8"), encoding="utf-8")
            candidate.unlink()
            candidate.symlink_to(target)

            with self.assertRaises(activate.ActivateError):
                activate.arm(esp, efivars, release_sha, "b")
            self.assertFalse((efivars / activate.VARIABLE_NAME).exists())

    def test_preexisting_symlinked_efi_variable_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, efivars, release_sha = self.fixture(root)
            outside = root / "outside"
            outside.write_bytes(b"do not touch")
            (efivars / activate.VARIABLE_NAME).symlink_to(outside)

            with self.assertRaises(activate.ActivateError):
                activate.arm(esp, efivars, release_sha, "b")
            self.assertEqual(outside.read_bytes(), b"do not touch")

    def test_payload_rejects_any_other_entry_id(self):
        with self.assertRaises(activate.ActivateError):
            activate.efivar_payload("ordax.conf")


if __name__ == "__main__":
    unittest.main()
