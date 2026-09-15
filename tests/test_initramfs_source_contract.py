import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
INIT = (ROOT / CONTRACT["root_init"]).read_text(encoding="utf-8")
BUILDER = (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8")


class InitramfsSourceContractTests(unittest.TestCase):
    def test_upstream_busybox_is_hash_pinned(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.initramfs-source/1")
        self.assertEqual(CONTRACT["busybox"]["version"], "1.38.0")
        self.assertRegex(CONTRACT["busybox"]["archive_sha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(CONTRACT["legacy_archive_imported"])

    def test_fixed_initramfs_has_narrow_responsibility(self):
        self.assertFalse(CONTRACT["network_inside_fixed_initramfs"])
        self.assertFalse(CONTRACT["ssh_inside_fixed_initramfs"])
        self.assertFalse(CONTRACT["control_plane_inside_fixed_initramfs"])
        self.assertEqual(CONTRACT["main_partition_label"], "ORDAX")
        self.assertEqual(CONTRACT["bootstrap_entrypoint"], "/ordax/bootstrap/entrypoint")

    def test_pid1_understands_only_new_storage_handoff(self):
        self.assertIn("findfs LABEL=ORDAX", INIT)
        self.assertIn("/ordax/bootstrap/entrypoint", INIT)
        for forbidden in ("ORDAX-HOME", "ORDAX-PLATFORM", "sshd", "remote-core", "control-plane", "codex"):
            self.assertNotIn(forbidden.lower(), INIT.lower())

    def test_builder_uses_minimal_busybox_and_explicit_musl_target_compiler(self):
        self.assertIn('"CONFIG_BUSYBOX": "y"', BUILDER)
        self.assertIn('make = ["make", f"CC={musl_cc}"]', BUILDER)
        self.assertIn('run(make + ["allnoconfig"]', BUILDER)
        self.assertIn('run(make + ["oldconfig"]', BUILDER)
        self.assertIn('"CONFIG_TC=y\\n"', BUILDER)
        self.assertIn('"CONFIG_TELNETD=y\\n"', BUILDER)
        self.assertIn('"CONFIG_HTTPD=y\\n"', BUILDER)
        self.assertIn('effective_specs_sha256', BUILDER)
        self.assertIn('"musl_specs_verified": True', BUILDER)

    def test_physical_use_remains_fail_closed(self):
        self.assertFalse(CONTRACT["build"]["physical_artifact_authorized"])
        self.assertEqual(CONTRACT["build"]["static_userspace"], "busybox-musl")
        self.assertEqual(CONTRACT["build"]["deterministic_cpio"], "newc")


if __name__ == "__main__":
    unittest.main()
