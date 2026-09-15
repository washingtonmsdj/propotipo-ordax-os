import os
from pathlib import Path
import stat
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SURFACE_ENTRYPOINT = ROOT / "system" / "surface" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class SystemRuntimeContractTests(unittest.TestCase):
    def test_runtime_chain_exists_and_is_executable(self):
        for path in (SYSTEM_ENTRYPOINT, SURFACE_ENTRYPOINT, SURFACE_RUNTIME):
            self.assertTrue(path.is_file(), path)
            mode = stat.S_IMODE(path.stat().st_mode)
            self.assertEqual(mode, 0o755, f"{path} mode={mode:o}")

    def test_shell_syntax_is_valid(self):
        for path in (SYSTEM_ENTRYPOINT, SURFACE_ENTRYPOINT, SURFACE_RUNTIME):
            subprocess.run(["sh", "-n", str(path)], check=True)

    def test_system_entrypoint_is_fail_closed(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("surface/entrypoint", text)
        self.assertIn("/ordax/bootstrap/recovery/entrypoint", text)
        self.assertNotIn("exec sh", text)
        self.assertNotIn("http://", text)
        self.assertNotIn("https://", text)

    def test_surface_entrypoint_owns_only_surface_handoff(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("bin/ordax-surface", text)
        self.assertIn("ORDAX_SURFACE_MODE=bootstrap-console", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_bootstrap_surface_is_noninteractive_and_non_networked(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("Surface bootstrap candidate", text)
        self.assertIn("sleep 3600", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
