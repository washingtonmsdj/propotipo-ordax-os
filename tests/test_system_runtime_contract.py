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
        self.assertIn("/usr/bin/barkery", text)
        self.assertNotIn("/usr/bin/cog", text)
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
        self.assertIn("barkery-browser", text)
        self.assertIn("xwayland", text)
        self.assertIn("eudev", text)
        self.assertIn("libinput-udev", text)
        self.assertNotIn("\n        cog ", text)
        self.assertIn("/bin/busybox chroot", text)
        self.assertIn("mesa-dri-gallium", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/python3", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/Xwayland", text)
        self.assertIn("$RUNTIME_ROOT/sbin/udevd", text)
        self.assertIn("$RUNTIME_ROOT/bin/udevadm", text)

    def test_existing_runtime_is_extended_without_full_reprovision(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime_base_is_ready", text)
        self.assertIn("upgrade_existing_runtime", text)
        self.assertIn("xwayland eudev libinput-udev", text)
        self.assertIn("extending existing graphical runtime with input discovery support", text)
        self.assertIn("RUNTIME_ID=alpine-v3.22-cage-barkery-v1", text)

    def test_native_browser_is_configured_for_local_shared_surface(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("/etc/barkery/barkery.conf", text)
        self.assertIn("start_uri = http://127.0.0.1:8765/composition/web/index.html", text)
        self.assertIn("GDK_BACKEND=wayland", text)
        self.assertIn("enabled = 0", text)

    def test_native_surface_http_server_is_runtime_owned_and_loopback_only(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox mount -o bind "$SYSTEM_ROOT"', text)
        self.assertIn("$RUNTIME_ROOT/srv/ordax-system", text)
        self.assertIn("/usr/bin/python3 -m http.server 8765", text)
        self.assertIn("--bind 127.0.0.1", text)
        self.assertIn("--directory /srv/ordax-system", text)
        self.assertIn("/sbin/ip link set dev lo up", text)
        self.assertIn("/sbin/ip address replace 127.0.0.1/8 dev lo", text)
        self.assertNotIn("/bin/busybox httpd", text)
        self.assertNotIn("--bind 0.0.0.0", text)

    def test_wlroots_physical_prerequisites_are_prepared(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("ensure_shared_memory", text)
        self.assertIn("mkdir -p /dev/shm", text)
        self.assertIn("chmod 1777 /dev/shm", text)
        self.assertIn("failed to prepare /dev/shm for wlroots/Xwayland", text)
        self.assertIn("failed to configure IPv4 loopback for local Surface HTTP", text)

    def test_physical_input_is_classified_with_runtime_owned_eudev(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("prepare_input_stack", text)
        self.assertIn("/dev/input/event*", text)
        self.assertIn("/sbin/udevd --daemon", text)
        self.assertIn("/bin/udevadm control --reload-rules", text)
        self.assertIn("/bin/udevadm trigger --subsystem-match=input --action=add", text)
        self.assertIn("/bin/udevadm settle --timeout=5", text)
        self.assertIn("eudev input classification complete", text)
        self.assertNotIn("WLR_LIBINPUT_NO_DEVICES=1", text)
        self.assertIn("failed to prepare physical keyboard/touchpad input devices", text)

    def test_native_host_clears_only_stale_seatd_socket(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("SEATD_SOCKET=/run/seatd.sock", text)
        self.assertIn("seatd_process_running", text)
        self.assertIn("remove_stale_seatd_socket", text)
        self.assertIn("seatd path exists but is not a UNIX socket", text)
        self.assertIn("seatd socket is owned by a running seatd process; refusing to remove it", text)
        self.assertIn("removing stale seatd socket", text)
        self.assertIn("failed to clear stale seatd socket before native host startup", text)

    def test_native_surface_fallback_exposes_physical_diagnostics(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("fallback_with_reason", text)
        self.assertIn("Diagnostic:", text)
        self.assertIn("HTTP diagnostic:", text)
        self.assertIn("HTTP log:", text)
        self.assertIn("DRM device /dev/dri/card0 is unavailable", text)
        self.assertIn("graphical runtime is unavailable after provisioning attempt", text)
        self.assertIn("failed to bind host resources into graphical runtime", text)
        self.assertIn("loopback Surface HTTP server failed to start", text)
        self.assertIn("native Cage/Barkery host exited with status", text)


if __name__ == "__main__":
    unittest.main()
