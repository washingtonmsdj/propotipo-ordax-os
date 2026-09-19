#!/usr/bin/env python3
"""Regress read-only inspection of OrdaX ESP layouts."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/esp_layout.py"
SOURCE = "a" * 40


def load_module():
    spec = spec_from_file_location("ordax_esp_layout_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


layout = load_module()


class EspLayoutTests(unittest.TestCase):
    def write_entry(
        self,
        root: Path,
        name: str,
        *,
        mode: str,
        kernel: str,
        initramfs: str,
        extra_options: str = "",
    ) -> None:
        path = root / "loader/entries" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        options = f"console=tty0 ordax.mode={mode}"
        if extra_options:
            options += " " + extra_options
        path.write_text(
            "title OrdaX\n"
            f"linux {kernel}\n"
            f"initrd {initramfs}\n"
            f"options {options}\n",
            encoding="utf-8",
        )

    def artifact(self, root: Path, absolute: str, payload: bytes = b"fixture\n") -> None:
        path = root / absolute.lstrip("/")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def legacy_fixture(self, root: Path) -> None:
        self.write_entry(
            root,
            "ordax.conf",
            mode="normal",
            kernel="/ordax/vmlinuz",
            initramfs="/ordax/initrd.gz",
        )
        self.write_entry(
            root,
            "ordax-recovery.conf",
            mode="recovery",
            kernel="/ordax/vmlinuz",
            initramfs="/ordax/initrd.gz",
        )
        self.artifact(root, "/ordax/vmlinuz")
        self.artifact(root, "/ordax/initrd.gz")

    def ab_fixture(self, root: Path, current: str = "a", recovery: str = "a") -> None:
        self.write_entry(
            root,
            "ordax.conf",
            mode="normal",
            kernel=f"/ordax/base/{current}/vmlinuz",
            initramfs=f"/ordax/base/{current}/initrd.gz",
            extra_options=f"ordax.base_slot={current}",
        )
        self.write_entry(
            root,
            "ordax-recovery.conf",
            mode="recovery",
            kernel=f"/ordax/base/{recovery}/vmlinuz",
            initramfs=f"/ordax/base/{recovery}/initrd.gz",
            extra_options=f"ordax.base_slot={recovery}",
        )
        for slot in {current, recovery}:
            self.artifact(root, f"/ordax/base/{slot}/vmlinuz")
            self.artifact(root, f"/ordax/base/{slot}/initrd.gz")

    def candidate(self, root: Path, slot: str = "b", source: str = SOURCE) -> None:
        self.write_entry(
            root,
            "ordax-candidate+01-00.conf",
            mode="normal",
            kernel=f"/ordax/base/{slot}/vmlinuz",
            initramfs=f"/ordax/base/{slot}/initrd.gz",
            extra_options=f"ordax.base_slot={slot} ordax.base_candidate={source}",
        )
        self.artifact(root, f"/ordax/base/{slot}/vmlinuz", b"candidate kernel\n")
        self.artifact(root, f"/ordax/base/{slot}/initrd.gz", b"candidate initramfs\n")

    def test_legacy_layout_reports_legacy_stage_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.legacy_fixture(root)

            value = layout.inspect_layout(root)

            self.assertEqual(value["$schema"], "prototype-ordax.esp-layout/1")
            self.assertEqual(value["layout"], "legacy")
            self.assertEqual(value["stage_active_slot"], "legacy")
            self.assertEqual(value["active_slot"], "legacy")
            self.assertEqual(value["recovery_slot"], "legacy")
            self.assertFalse(value["candidate_entry_present"])
            self.assertIsNone(value["candidate_slot"])
            self.assertIsNone(value["candidate_release_sha"])
            self.assertFalse(value["write_authorized"])
            self.assertFalse(value["activation_authorized"])

    def test_ab_layout_reports_current_and_recovery_slots(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.ab_fixture(root, current="b", recovery="a")

            value = layout.inspect_layout(root)

            self.assertEqual(value["layout"], "ab")
            self.assertEqual(value["stage_active_slot"], "b")
            self.assertEqual(value["active_slot"], "b")
            self.assertEqual(value["recovery_slot"], "a")
            self.assertFalse(value["candidate_entry_present"])

    def test_staged_candidate_identity_is_reported_without_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.ab_fixture(root, current="a", recovery="a")
            self.candidate(root, slot="b")

            value = layout.inspect_layout(root)

            self.assertTrue(value["candidate_entry_present"])
            self.assertEqual(value["candidate_slot"], "b")
            self.assertEqual(value["candidate_release_sha"], SOURCE)
            self.assertFalse(value["write_authorized"])
            self.assertFalse(value["activation_authorized"])

    def test_mismatched_candidate_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.ab_fixture(root)
            self.write_entry(
                root,
                "ordax-candidate+01-00.conf",
                mode="normal",
                kernel="/ordax/base/a/vmlinuz",
                initramfs="/ordax/base/a/initrd.gz",
                extra_options=f"ordax.base_slot=b ordax.base_candidate={SOURCE}",
            )

            with self.assertRaisesRegex(
                layout.EspLayoutError,
                "artifact paths do not match",
            ):
                layout.inspect_layout(root)

    def test_symlinked_known_good_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.legacy_fixture(root)
            current = root / "loader/entries/ordax.conf"
            current.unlink()
            current.symlink_to(root / "loader/entries/ordax-recovery.conf")

            with self.assertRaisesRegex(
                layout.EspLayoutError,
                "regular non-symlink",
            ):
                layout.inspect_layout(root)


if __name__ == "__main__":
    unittest.main()
