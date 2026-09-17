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
        self.assertIn("ORDAX_SURFACE_MODE=native-auto", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_surface_reuses_shared_web_composition(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("composition/web/index.html", text)
        self.assertIn("/usr/bin/cage", text)
        self.assertIn("/usr/bin/cog", text)
        self.assertIn("/usr/bin/seatd-launch", text)
        self.assertIn("/dev/dri/card0", text)
        self.assertIn("ORDAX_SURFACE_MODE=native-graphical", text)
        self.assertIn("127.0.0.1:8765", text)
        self.assertIn("console_fallback", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_graphical_runtime_is_provisioned_from_pulled_system(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime/native-surface", text)
        self.assertIn("/sbin/apk --root", text)
        self.assertIn("--keys-dir /etc/apk/keys", text)
        self.assertIn("alpine/v3.22/main", text)
        self.assertIn("alpine/v3.22/community", text)
        self.assertIn("/bin/busybox chroot", text)
        self.assertIn("mesa-dri-gallium", text)

    def test_native_surface_http_server_is_loopback_only(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("-p 127.0.0.1:8765", text)
        self.assertNotIn("-p 0.0.0.0", text)


if __name__ == "__main__":
    unittest.main()
