import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "system-metrics.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "system-metrics.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_metrics_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeSystemMetricsTests(unittest.TestCase):
    def test_meminfo_parser_requires_bounded_total_and_available(self):
        total, available = native_host.parse_meminfo(
            "MemTotal:       8000000 kB\nMemAvailable:   2500000 kB\nBuffers: 1 kB\n"
        )
        self.assertEqual(total, 8_000_000 * 1024)
        self.assertEqual(available, 2_500_000 * 1024)
        with self.assertRaises(ValueError):
            native_host.parse_meminfo("MemTotal: 10 kB\n")
        with self.assertRaises(ValueError):
            native_host.parse_meminfo("MemTotal: 10 kB\nMemAvailable: 11 kB\n")

    def test_metrics_reader_exposes_only_aggregate_numbers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            proc = root / "proc"
            user = root / "user"
            proc.mkdir()
            user.mkdir()
            (proc / "uptime").write_text("3723.88 7200.00\n", encoding="utf-8")
            (proc / "meminfo").write_text(
                "MemTotal: 4096 kB\nMemAvailable: 1024 kB\nMemFree: 512 kB\n",
                encoding="utf-8",
            )

            metrics = native_host.read_system_metrics(str(user), str(proc))
            self.assertEqual(metrics["uptimeSeconds"], 3723)
            self.assertEqual(metrics["memoryTotalBytes"], 4096 * 1024)
            self.assertEqual(metrics["memoryAvailableBytes"], 1024 * 1024)
            self.assertGreater(metrics["userStorageTotalBytes"], 0)
            self.assertGreaterEqual(metrics["userStorageFreeBytes"], 0)
            self.assertLessEqual(metrics["userStorageFreeBytes"], metrics["userStorageTotalBytes"])
            self.assertEqual(
                set(metrics),
                {
                    "uptimeSeconds",
                    "memoryTotalBytes",
                    "memoryAvailableBytes",
                    "userStorageTotalBytes",
                    "userStorageFreeBytes",
                },
            )

    def test_metrics_contract_adapter_and_shared_ui_stay_separated(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        controls = CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('ordax.system-metrics/1', contract)
        self.assertIn("validateSystemMetricsSnapshot", contract)
        self.assertIn('/__ordax/native/metrics', adapter)
        self.assertIn("await port.read()", adapter)
        self.assertIn("contracts/system-metrics.mjs", controls)
        self.assertIn("./surface-lifecycle.mjs", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertNotIn("MutationObserver", controls)
        self.assertIn("Tempo ligado", controls)
        self.assertIn("Espaço do usuário", controls)
        self.assertIn("Uso do dispositivo", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("/proc", controls)
        self.assertIn("createNativeSystemMetrics", composition)
        self.assertIn("mountSystemOverviewControls(", composition)
        self.assertIn("systemMetrics,", composition)
        self.assertIn("systemMetricsAvailable", composition)

    def test_capability_is_native_only_and_read_only(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["system.metrics"]["security_boundary"],
            "read-only-device-observability",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("system.metrics", modes["usb"]["baseline_capabilities"])
        self.assertIn("system.metrics", modes["native-disk"]["baseline_capabilities"])
        self.assertNotIn("system.metrics", modes["web"]["baseline_capabilities"])
        self.assertNotIn("system.metrics", modes["mobile"]["baseline_capabilities"])
        self.assertNotIn("system.metrics", modes["desktop"]["baseline_capabilities"])

    def test_host_metrics_endpoint_is_loopback_read_only(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('METRICS_PATH = "/__ordax/native/metrics"', server)
        self.assertIn("read_system_metrics(self.server.user_root)", server)
        self.assertIn("parsed_path in {FILES_PATH, FILE_CONTENT_PATH, METRICS_PATH}", server)
        self.assertNotIn("if self.path == METRICS_PATH", server.split("def do_POST", 1)[1])


if __name__ == "__main__":
    unittest.main()
