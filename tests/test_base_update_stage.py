#!/usr/bin/env python3
"""Disposable-directory regressions for OrdaX base candidate staging."""

import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap" / "base-update" / "stage.py"
spec = importlib.util.spec_from_file_location("ordax_base_update_stage_test", MODULE_PATH)
stage = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(stage)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_signed_release_fixture(root: Path):
    commit = "a" * 40
    kernel_sha = "b" * 64
    initramfs_sha = "c" * 64
    releases_root = root / "releases"
    release_root = releases_root / commit
    artifact_root = release_root / "artifacts"
    artifact_root.mkdir(parents=True)

    descriptor = json.dumps(
        {
            "$schema": "prototype-ordax.base-update-candidate/1",
            "kernel_sha256": kernel_sha,
            "initramfs_sha256": initramfs_sha,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    archive_path = artifact_root / "system.tar"
    with tarfile.open(archive_path, mode="w") as archive:
        info = tarfile.TarInfo("system/base-update/candidate.json")
        info.size = len(descriptor)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(descriptor))

    manifest = {
        "$schema": "prototype-ordax.release-manifest/1",
        "source_repository": "washingtonmsdj/prototipo-ordax-os",
        "source_commit": commit,
        "release_id": commit,
        "created_from_ci_recipe": "release/native/1",
        "artifacts": [
            {
                "name": "system.tar",
                "role": "system",
                "url": "https://example.invalid/system.tar",
                "sha256": digest(archive_path.read_bytes()),
                "size": archive_path.stat().st_size,
            }
        ],
    }
    manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    (release_root / "release-manifest.json").write_bytes(manifest_bytes)

    envelope = root / "release-envelope.json"
    envelope.write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.release-envelope/1",
                "payload": base64.b64encode(manifest_bytes).decode("ascii"),
                "signature": base64.b64encode(b"0" * 64).decode("ascii"),
                "key_id": "ordax-prototype-release-v1",
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    trust = root / "release-ed25519.json"
    trust.write_text("{}\n", encoding="utf-8")
    agent = root / "ordax-release-agent"
    agent.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' "
        + json.dumps(
            json.dumps(
                {
                    "status": "verified",
                    "source_commit": commit,
                    "artifact_count": 1,
                },
                separators=(",", ":"),
            )
        )
        + "\n",
        encoding="utf-8",
    )
    agent.chmod(0o755)
    return agent, envelope, trust, releases_root, archive_path, commit, kernel_sha, initramfs_sha


class BaseUpdateStageTests(unittest.TestCase):
    def fixture(self, root: Path):
        esp = root / "esp"
        (esp / "loader" / "entries").mkdir(parents=True)
        (esp / "ordax" / "base" / "a").mkdir(parents=True)
        current = esp / "loader" / "entries" / "ordax.conf"
        recovery = esp / "loader" / "entries" / "ordax-recovery.conf"
        active_kernel = esp / "ordax" / "base" / "a" / "vmlinuz"
        active_initrd = esp / "ordax" / "base" / "a" / "initrd.gz"
        current.write_text("current-a\n", encoding="utf-8")
        recovery.write_text("recovery-a\n", encoding="utf-8")
        active_kernel.write_bytes(b"known-good-kernel")
        active_initrd.write_bytes(b"known-good-initramfs")

        kernel = root / "candidate-kernel"
        initrd = root / "candidate-initrd"
        kernel_bytes = b"candidate-kernel-bytes"
        initrd_bytes = b"candidate-initramfs-bytes"
        kernel.write_bytes(kernel_bytes)
        initrd.write_bytes(initrd_bytes)
        candidate = {
            "release_sha": "a" * 40,
            "kernel_sha256": digest(kernel_bytes),
            "initramfs_sha256": digest(initrd_bytes),
        }
        return esp, kernel, initrd, candidate

    def test_stage_writes_only_inactive_slot_and_candidate_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, kernel, initrd, candidate = self.fixture(root)
            protected = {
                "current": (esp / "loader/entries/ordax.conf").read_bytes(),
                "recovery": (esp / "loader/entries/ordax-recovery.conf").read_bytes(),
                "kernel": (esp / "ordax/base/a/vmlinuz").read_bytes(),
                "initrd": (esp / "ordax/base/a/initrd.gz").read_bytes(),
            }

            result = stage.stage(esp, "a", candidate, kernel, initrd)

            self.assertTrue(result["activation_ready"])
            self.assertFalse(result["efi_variable_written"])
            self.assertFalse(result["reboot_requested"])
            self.assertEqual((esp / "ordax/base/b/vmlinuz").read_bytes(), kernel.read_bytes())
            self.assertEqual((esp / "ordax/base/b/initrd.gz").read_bytes(), initrd.read_bytes())
            self.assertEqual((esp / "loader/entries/ordax.conf").read_bytes(), protected["current"])
            self.assertEqual(
                (esp / "loader/entries/ordax-recovery.conf").read_bytes(),
                protected["recovery"],
            )
            self.assertEqual((esp / "ordax/base/a/vmlinuz").read_bytes(), protected["kernel"])
            self.assertEqual((esp / "ordax/base/a/initrd.gz").read_bytes(), protected["initrd"])

            entry = (esp / "loader/entries/ordax-candidate+01-00.conf").read_text(
                encoding="utf-8"
            )
            self.assertIn("linux /ordax/base/b/vmlinuz", entry)
            self.assertIn("initrd /ordax/base/b/initrd.gz", entry)
            self.assertIn("ordax.base_slot=b", entry)
            self.assertIn("ordax.base_candidate=" + "a" * 40, entry)

    def test_existing_candidate_marker_blocks_before_inactive_slot_is_touched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, kernel, initrd, candidate = self.fixture(root)
            inactive = esp / "ordax/base/b"
            inactive.mkdir(parents=True)
            stale_kernel = inactive / "vmlinuz"
            stale_kernel.write_bytes(b"stale")
            marker = esp / "loader/entries/ordax-candidate+01-00.conf"
            marker.write_text("stale marker\n", encoding="utf-8")

            with self.assertRaises(stage.StageError):
                stage.stage(esp, "a", candidate, kernel, initrd)

            self.assertEqual(stale_kernel.read_bytes(), b"stale")
            self.assertEqual(marker.read_text(encoding="utf-8"), "stale marker\n")

    def test_bad_digest_fails_without_candidate_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, kernel, initrd, candidate = self.fixture(root)
            candidate["kernel_sha256"] = "f" * 64

            with self.assertRaises(stage.StageError):
                stage.stage(esp, "a", candidate, kernel, initrd)

            self.assertFalse((esp / "loader/entries/ordax-candidate+01-00.conf").exists())
            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())

    def test_symlink_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, kernel, initrd, candidate = self.fixture(root)
            link = root / "kernel-link"
            link.symlink_to(kernel)

            with self.assertRaises(stage.StageError):
                stage.stage(esp, "a", candidate, link, initrd)

            self.assertFalse((esp / "loader/entries/ordax-candidate+01-00.conf").exists())

    def test_missing_known_good_entries_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, kernel, initrd, candidate = self.fixture(root)
            (esp / "loader/entries/ordax-recovery.conf").unlink()

            with self.assertRaises(stage.StageError):
                stage.stage(esp, "a", candidate, kernel, initrd)

            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())


    def legacy_fixture(self, root: Path):
        esp = root / "legacy-esp"
        (esp / "loader" / "entries").mkdir(parents=True)
        (esp / "ordax").mkdir(parents=True)
        current = esp / "loader/entries/ordax.conf"
        recovery = esp / "loader/entries/ordax-recovery.conf"
        legacy_kernel = esp / "ordax/vmlinuz"
        legacy_initrd = esp / "ordax/initrd.gz"
        current.write_text(
            "title OrdaX\n"
            "linux /ordax/vmlinuz\n"
            "initrd /ordax/initrd.gz\n"
            "options console=tty0 ordax.mode=normal\n",
            encoding="utf-8",
        )
        recovery.write_text(
            "title OrdaX Recovery\n"
            "linux /ordax/vmlinuz\n"
            "initrd /ordax/initrd.gz\n"
            "options console=tty0 ordax.mode=recovery\n",
            encoding="utf-8",
        )
        legacy_kernel.write_bytes(b"legacy-known-good-kernel")
        legacy_initrd.write_bytes(b"legacy-known-good-initramfs")

        kernel = root / "legacy-candidate-kernel"
        initrd = root / "legacy-candidate-initrd"
        kernel.write_bytes(b"new-acpi-kernel")
        initrd.write_bytes(b"new-acpi-initramfs")
        candidate = {
            "release_sha": "d" * 40,
            "kernel_sha256": digest(kernel.read_bytes()),
            "initramfs_sha256": digest(initrd.read_bytes()),
        }
        return (
            esp,
            kernel,
            initrd,
            candidate,
            current,
            recovery,
            legacy_kernel,
            legacy_initrd,
        )

    def test_legacy_stage_preserves_default_and_enrolls_known_good_as_slot_a(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                current,
                recovery,
                legacy_kernel,
                legacy_initrd,
            ) = self.legacy_fixture(root)
            protected_before = {
                "current": current.read_bytes(),
                "recovery": recovery.read_bytes(),
                "kernel": legacy_kernel.read_bytes(),
                "initrd": legacy_initrd.read_bytes(),
            }

            result = stage.stage(
                esp,
                "legacy",
                candidate,
                kernel,
                initrd,
            )

            self.assertEqual(result["active_slot"], "legacy")
            self.assertEqual(result["previous_slot"], "a")
            self.assertEqual(result["candidate_slot"], "b")
            self.assertTrue(result["legacy_enrollment"])
            self.assertTrue(result["legacy_current_entry_unchanged"])
            self.assertFalse(result["legacy_baseline_reused"])
            self.assertTrue(result["activation_ready"])
            self.assertFalse(result["reboot_requested"])

            self.assertEqual(current.read_bytes(), protected_before["current"])
            self.assertEqual(recovery.read_bytes(), protected_before["recovery"])
            self.assertEqual(legacy_kernel.read_bytes(), protected_before["kernel"])
            self.assertEqual(legacy_initrd.read_bytes(), protected_before["initrd"])
            self.assertEqual(
                (esp / "ordax/base/a/vmlinuz").read_bytes(),
                protected_before["kernel"],
            )
            self.assertEqual(
                (esp / "ordax/base/a/initrd.gz").read_bytes(),
                protected_before["initrd"],
            )
            self.assertEqual(
                (esp / "ordax/base/b/vmlinuz").read_bytes(),
                kernel.read_bytes(),
            )
            self.assertEqual(
                (esp / "ordax/base/b/initrd.gz").read_bytes(),
                initrd.read_bytes(),
            )
            candidate_entry = (
                esp / "loader/entries/ordax-candidate+01-00.conf"
            ).read_text(encoding="utf-8")
            self.assertIn("linux /ordax/base/b/vmlinuz", candidate_entry)
            self.assertIn("ordax.base_slot=b", candidate_entry)
            self.assertIn(
                "ordax.base_candidate=" + candidate["release_sha"],
                candidate_entry,
            )

    def test_ensure_existing_legacy_stage_is_idempotent_only_when_everything_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                current,
                recovery,
                legacy_kernel,
                legacy_initrd,
            ) = self.legacy_fixture(root)
            first = stage.ensure_stage(
                esp,
                "legacy",
                candidate,
                kernel,
                initrd,
            )
            self.assertFalse(first["idempotent"])

            protected = {
                "current": current.read_bytes(),
                "recovery": recovery.read_bytes(),
                "kernel": legacy_kernel.read_bytes(),
                "initrd": legacy_initrd.read_bytes(),
            }
            second = stage.ensure_stage(
                esp,
                "legacy",
                candidate,
                kernel,
                initrd,
            )

            self.assertTrue(second["idempotent"])
            self.assertEqual(second["release_sha"], candidate["release_sha"])
            self.assertEqual(second["active_slot"], "legacy")
            self.assertEqual(second["candidate_slot"], "b")
            self.assertFalse(second["efi_variable_written"])
            self.assertFalse(second["reboot_requested"])
            self.assertEqual(current.read_bytes(), protected["current"])
            self.assertEqual(recovery.read_bytes(), protected["recovery"])
            self.assertEqual(legacy_kernel.read_bytes(), protected["kernel"])
            self.assertEqual(legacy_initrd.read_bytes(), protected["initrd"])

    def test_ensure_existing_rejects_stale_or_tampered_candidate_without_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                current,
                recovery,
                _legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            stage.ensure_stage(esp, "legacy", candidate, kernel, initrd)
            marker_path = esp / "loader/entries/ordax-candidate+01-00.conf"
            marker_path.write_text("stale\n", encoding="utf-8")
            current_before = current.read_bytes()
            recovery_before = recovery.read_bytes()
            staged_kernel_before = (esp / "ordax/base/b/vmlinuz").read_bytes()
            staged_initrd_before = (esp / "ordax/base/b/initrd.gz").read_bytes()

            with self.assertRaisesRegex(
                stage.StageError,
                "candidate boot entry differs",
            ):
                stage.ensure_stage(
                    esp,
                    "legacy",
                    candidate,
                    kernel,
                    initrd,
                )

            self.assertEqual(marker_path.read_text(encoding="utf-8"), "stale\n")
            self.assertEqual(current.read_bytes(), current_before)
            self.assertEqual(recovery.read_bytes(), recovery_before)
            self.assertEqual(
                (esp / "ordax/base/b/vmlinuz").read_bytes(),
                staged_kernel_before,
            )
            self.assertEqual(
                (esp / "ordax/base/b/initrd.gz").read_bytes(),
                staged_initrd_before,
            )

    def test_ensure_existing_rejects_tampered_staged_kernel(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                _current,
                _recovery,
                _legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            stage.ensure_stage(esp, "legacy", candidate, kernel, initrd)
            (esp / "ordax/base/b/vmlinuz").write_bytes(b"tampered-stage")

            with self.assertRaisesRegex(
                stage.StageError,
                "staged kernel digest differs",
            ):
                stage.ensure_stage(
                    esp,
                    "legacy",
                    candidate,
                    kernel,
                    initrd,
                )

    def test_legacy_matching_slot_a_is_idempotently_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                _current,
                _recovery,
                legacy_kernel,
                legacy_initrd,
            ) = self.legacy_fixture(root)
            baseline = esp / "ordax/base/a"
            baseline.mkdir(parents=True)
            (baseline / "vmlinuz").write_bytes(legacy_kernel.read_bytes())
            (baseline / "initrd.gz").write_bytes(legacy_initrd.read_bytes())

            result = stage.stage(
                esp,
                "legacy",
                candidate,
                kernel,
                initrd,
            )

            self.assertTrue(result["legacy_baseline_reused"])
            self.assertEqual(
                (baseline / "vmlinuz").read_bytes(),
                legacy_kernel.read_bytes(),
            )
            self.assertEqual(
                (baseline / "initrd.gz").read_bytes(),
                legacy_initrd.read_bytes(),
            )

    def test_legacy_conflicting_baseline_fails_before_any_baseline_or_candidate_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                _current,
                _recovery,
                _legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            baseline = esp / "ordax/base/a"
            baseline.mkdir(parents=True)
            (baseline / "initrd.gz").write_bytes(b"conflicting-old-bytes")

            with self.assertRaisesRegex(
                stage.StageError,
                "baseline conflicts",
            ):
                stage.stage(
                    esp,
                    "legacy",
                    candidate,
                    kernel,
                    initrd,
                )

            self.assertFalse((baseline / "vmlinuz").exists())
            self.assertEqual(
                (baseline / "initrd.gz").read_bytes(),
                b"conflicting-old-bytes",
            )
            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())
            self.assertFalse(
                (esp / "loader/entries/ordax-candidate+01-00.conf").exists()
            )

    def test_legacy_candidate_marker_blocks_before_slot_a_enrollment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                _current,
                _recovery,
                _legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            marker = esp / "loader/entries/ordax-candidate+01-00.conf"
            marker.write_text("stale\n", encoding="utf-8")

            with self.assertRaises(stage.StageError):
                stage.stage(
                    esp,
                    "legacy",
                    candidate,
                    kernel,
                    initrd,
                )

            self.assertFalse((esp / "ordax/base/a/vmlinuz").exists())
            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())
            self.assertEqual(marker.read_text(encoding="utf-8"), "stale\n")

    def test_legacy_symlink_source_and_ab_managed_current_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                current,
                _recovery,
                legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            target = root / "outside-kernel"
            target.write_bytes(legacy_kernel.read_bytes())
            legacy_kernel.unlink()
            legacy_kernel.symlink_to(target)

            with self.assertRaises(stage.StageError):
                stage.stage(esp, "legacy", candidate, kernel, initrd)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (
                esp,
                kernel,
                initrd,
                candidate,
                current,
                _recovery,
                _legacy_kernel,
                _legacy_initrd,
            ) = self.legacy_fixture(root)
            current.write_text(
                current.read_text(encoding="utf-8").replace(
                    "ordax.mode=normal",
                    "ordax.mode=normal ordax.base_slot=a",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                stage.StageError,
                "already A/B-managed",
            ):
                stage.stage(esp, "legacy", candidate, kernel, initrd)

            self.assertFalse((esp / "ordax/base/a/vmlinuz").exists())

    def test_signed_release_descriptor_is_required_before_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            agent, envelope, trust, releases, _archive, commit, kernel_sha, initramfs_sha = (
                make_signed_release_fixture(root)
            )

            candidate = stage.verified_candidate_from_release(
                envelope,
                trust,
                agent,
                releases,
            )

            self.assertEqual(
                candidate,
                {
                    "release_sha": commit,
                    "kernel_sha256": kernel_sha,
                    "initramfs_sha256": initramfs_sha,
                },
            )

    def test_failed_canonical_release_verifier_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            agent, envelope, trust, releases, _archive, _commit, _kernel, _initramfs = (
                make_signed_release_fixture(root)
            )
            agent.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            agent.chmod(0o755)

            with self.assertRaises(stage.StageError):
                stage.verified_candidate_from_release(envelope, trust, agent, releases)

    def test_signed_system_archive_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            agent, envelope, trust, releases, archive, _commit, _kernel, _initramfs = (
                make_signed_release_fixture(root)
            )
            payload = bytearray(archive.read_bytes())
            payload[0] ^= 1
            archive.write_bytes(payload)

            with self.assertRaises(stage.StageError):
                stage.verified_candidate_from_release(envelope, trust, agent, releases)

    def test_stage_cli_has_no_unsigned_or_alternate_trust_input(self):
        text = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn('parser.add_argument("--candidate"', text)
        self.assertIn('parser.add_argument("--envelope"', text)
        self.assertIn('choices=("a", "b", "legacy")', text)
        self.assertNotIn('parser.add_argument("--trust"', text)
        self.assertNotIn('parser.add_argument("--release-agent"', text)
        self.assertNotIn('parser.add_argument("--releases-root"', text)
        self.assertIn("DEFAULT_TRUST", text)
        self.assertIn("DEFAULT_RELEASE_AGENT", text)
        self.assertIn("DEFAULT_RELEASES_ROOT", text)
        self.assertIn('"verify-envelope"', text)
        self.assertNotIn('"verify-base-update-envelope"', text)


if __name__ == "__main__":
    unittest.main()
