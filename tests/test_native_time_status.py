import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "system" / "contracts" / "time-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "time-status.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "date-time-quick-panel.mjs"
SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_time_status_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeTimeStatusTests(unittest.TestCase):
    def test_reader_requires_matching_ntpd_process_and_exposes_no_process_details(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            proc = root / "proc"
            proc.mkdir()
            pid_file = root / "time-sync.pid"
            pid_file.write_text("4242\n", encoding="utf-8")
            process = proc / "4242"
            process.mkdir()
            (process / "cmdline").write_bytes(
                b"/bin/busybox\x00ntpd\x00-n\x00-p\x00time.example.invalid\x00"
            )

            snapshot = native_host.read_time_status(str(pid_file), str(proc))
            self.assertEqual(snapshot, {"automaticSync": "running"})
            flattened = json.dumps(snapshot).lower()
            for forbidden in ("4242", "ntpd", "time.example", "pid", "peer"):
                self.assertNotIn(forbidden, flattened)

            (process / "cmdline").write_bytes(b"/bin/busybox\x00sleep\x00100\x00")
            self.assertEqual(
                native_host.read_time_status(str(pid_file), str(proc)),
                {"automaticSync": "unavailable"},
            )

    def test_reader_fails_soft_for_stale_or_invalid_pid_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            proc = root / "proc"
            proc.mkdir()
            pid_file = root / "time-sync.pid"
            for value in ("", "abc", "1", "9999"):
                pid_file.write_text(value + "\n", encoding="utf-8")
                self.assertEqual(
                    native_host.read_time_status(str(pid_file), str(proc)),
                    {"automaticSync": "unavailable"},
                )

    def test_launcher_persists_private_time_sync_pid_and_cleans_it(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("TIME_SYNC_PID_FILE=$SESSION_DIR/time-sync.pid", launcher)
        self.assertIn('printf \'%s\\n\' "$TIME_SYNC_PID" >"$temporary"', launcher)
        self.assertIn('chmod 600 "$temporary"', launcher)
        self.assertIn('/bin/busybox mv -f "$temporary" "$TIME_SYNC_PID_FILE"', launcher)
        self.assertIn('rm -f "$TIME_SYNC_PID_FILE"', launcher)

    def test_contract_adapter_panel_and_native_composition_are_separated(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        controls = CONTROLS.read_text(encoding="utf-8")
        shell = SHELL.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")

        self.assertIn('ordax.time-status/1', contract)
        self.assertIn('/__ordax/native/time-status', adapter)
        self.assertIn("assertTimeStatusPort", controls)
        self.assertIn("data-quick-time-sync-state", shell)
        self.assertIn("createNativeTimeStatus", composition)
        self.assertIn("mountDateTimeQuickPanel(root, timeStatus)", composition)
        self.assertIn('reportClientDiagnostic("date-time-quick-panel", error)', composition)
        self.assertIn("dateTimeQuickPanel?.destroy()", composition)
        self.assertIn('"time.status"', runtime)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("pid", controls.lower())
        self.assertNotIn("peer", controls.lower())

    def test_capability_is_native_only_and_read_only(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["time.status"]["security_boundary"],
            "read-only-time-sync-observability",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("time.status", modes["usb"]["baseline_capabilities"])
        self.assertIn("time.status", modes["native-disk"]["baseline_capabilities"])
        for mode in ("web", "mobile", "desktop"):
            self.assertNotIn("time.status", modes[mode]["baseline_capabilities"])

    def test_host_time_status_endpoint_is_loopback_get_only(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn('TIME_STATUS_PATH = "/__ordax/native/time-status"', server)
        self.assertIn("read_time_status()", get_section)
        self.assertIn("TIME_STATUS_PATH", get_section)
        self.assertNotIn("if self.path == TIME_STATUS_PATH", post_section)


if __name__ == "__main__":
    unittest.main()
