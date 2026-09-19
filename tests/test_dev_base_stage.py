from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "bootstrap" / "base-update" / "dev_stage.py"
spec = spec_from_file_location("ordax_dev_base_stage_test", MODULE)
dev_stage = module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(dev_stage)

SOURCE = "3" * 40


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class DevBaseStageTests(unittest.TestCase):
    def fixture(self, root: Path):
        esp = root / "esp"
        (esp / "loader/entries").mkdir(parents=True)
        (esp / "ordax/base/a").mkdir(parents=True)
        (esp / "loader/entries/ordax.conf").write_text(
            "title OrdaX\nlinux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=normal ordax.base_slot=a\n",
            encoding="utf-8",
        )
        (esp / "loader/entries/ordax-recovery.conf").write_text(
            "title OrdaX Recovery\nlinux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=recovery ordax.base_slot=a\n",
            encoding="utf-8",
        )
        (esp / "ordax/base/a/vmlinuz").write_bytes(b"known-good-kernel")
        (esp / "ordax/base/a/initrd.gz").write_bytes(b"known-good-initramfs")

        candidate = root / "candidate"
        candidate.mkdir()
        kernel = candidate / "vmlinuz"
        initramfs = candidate / "initrd.gz"
        kernel_bytes = b"git-development-kernel\n"
        initramfs_bytes = b"git-development-initramfs\n"
        kernel.write_bytes(kernel_bytes)
        initramfs.write_bytes(initramfs_bytes)
        tag = f"ordax-dev-base-{SOURCE}"
        prefix = (
            "https://github.com/washingtonmsdj/prototipo-ordax-os/"
            f"releases/download/{tag}"
        )
        manifest = {
            "$schema": dev_stage.SCHEMA,
            "status": "development-candidate",
            "source_repository": dev_stage.REPOSITORY,
            "source_commit": SOURCE,
            "tag": tag,
            "activation": "inactive-slot-next-boot",
            "manual_usb_rewrite_required": False,
            "kernel": {
                "name": "vmlinuz",
                "url": f"{prefix}/vmlinuz",
                "sha256": digest(kernel_bytes),
                "size": len(kernel_bytes),
            },
            "initramfs": {
                "name": "initrd.gz",
                "url": f"{prefix}/initrd.gz",
                "sha256": digest(initramfs_bytes),
                "size": len(initramfs_bytes),
            },
        }
        manifest_path = candidate / "dev-base.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return esp, manifest_path, kernel, initramfs

    def test_exact_git_candidate_stages_and_reuses_inactive_slot(self):
        with tempfile.TemporaryDirectory() as temporary:
            esp, manifest, kernel, initramfs = self.fixture(Path(temporary))
            current_before = (esp / "loader/entries/ordax.conf").read_bytes()

            first = dev_stage.stage_development_candidate(
                esp_root=esp,
                active_slot="a",
                manifest_path=manifest,
                kernel_path=kernel,
                initramfs_path=initramfs,
                expected_commit=SOURCE,
            )
            second = dev_stage.stage_development_candidate(
                esp_root=esp,
                active_slot="a",
                manifest_path=manifest,
                kernel_path=kernel,
                initramfs_path=initramfs,
                expected_commit=SOURCE,
            )

            self.assertFalse(first["idempotent"])
            self.assertTrue(second["idempotent"])
            self.assertEqual(first["candidate_slot"], "b")
            self.assertEqual(first["release_sha"], SOURCE)
            self.assertEqual(
                (esp / "ordax/base/b/vmlinuz").read_bytes(),
                kernel.read_bytes(),
            )
            self.assertEqual(
                (esp / "ordax/base/b/initrd.gz").read_bytes(),
                initramfs.read_bytes(),
            )
            self.assertEqual(
                (esp / "loader/entries/ordax.conf").read_bytes(),
                current_before,
            )
            marker = (
                esp / "loader/entries/ordax-candidate+01-00.conf"
            ).read_text(encoding="utf-8")
            self.assertIn("ordax.base_slot=b", marker)
            self.assertIn(f"ordax.base_candidate={SOURCE}", marker)

    def test_manifest_for_another_commit_fails_before_esp_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            esp, manifest, kernel, initramfs = self.fixture(Path(temporary))
            with self.assertRaisesRegex(
                dev_stage.DevStageError,
                "commit differs",
            ):
                dev_stage.stage_development_candidate(
                    esp_root=esp,
                    active_slot="a",
                    manifest_path=manifest,
                    kernel_path=kernel,
                    initramfs_path=initramfs,
                    expected_commit="4" * 40,
                )
            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())
            self.assertFalse(
                (esp / "loader/entries/ordax-candidate+01-00.conf").exists()
            )

    def test_tampered_kernel_fails_before_esp_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            esp, manifest, kernel, initramfs = self.fixture(Path(temporary))
            kernel.write_bytes(b"tampered\n")
            with self.assertRaisesRegex(
                dev_stage.DevStageError,
                "kernel (size|hash) differs",
            ):
                dev_stage.stage_development_candidate(
                    esp_root=esp,
                    active_slot="a",
                    manifest_path=manifest,
                    kernel_path=kernel,
                    initramfs_path=initramfs,
                    expected_commit=SOURCE,
                )
            self.assertFalse((esp / "ordax/base/b/vmlinuz").exists())


if __name__ == "__main__":
    unittest.main()
