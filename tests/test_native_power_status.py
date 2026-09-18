import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "power-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "power-status.mjs"
TRAY = ROOT / "system" / "surface" / "ui" / "battery-tray-controls.mjs"
SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_power_status_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativePowerStatusTests(unittest.TestCase):
    def _supply(self, root: Path, name: str, supply_type: str, **fields: str) -> None:
        path = root / name
        path.mkdir()
        (path / "type").write_text(supply_type + "\n", encoding="utf-8")
        for field, value in fields.items():
            (path / field).write_text(str(value) + "\n", encoding="utf-8")

    def test_reader_aggregates_batteries_without_exposing_identifiers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._supply(root, "BAT0", "Battery", capacity="80", status="Charging", serial_number="secret")
            self._supply(root, "BAT1", "Battery", capacity="60", status="Discharging", model_name="private")
            self._supply(root, "AC0", "Mains", online="1")
            snapshot = native_host.read_power_status(str(root))
            self.assertEqual(
                snapshot,
                {
                    "battery": {"percent": 70, "state": "charging"},
                    "externalPower": True,
                },
            )
            flattened = json.dumps(snapshot).lower()
            for forbidden in ("bat0", "bat1", "serial", "model", "secret", "private"):
                self.assertNotIn(forbidden, flattened)

    def test_reader_handles_absent_or_invalid_battery_fail_soft(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._supply(root, "BAT0", "Battery", capacity="999", status="Charging")
            self._supply(root, "BAT1", "Battery", present="0", capacity="0", status="Unknown")
            self._supply(root, "AC0", "Mains", online="0")
            self.assertEqual(
                native_host.read_power_status(str(root)),
                {"battery": None, "externalPower": False},
            )
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(
                native_host.read_power_status(temporary),
                {"battery": None, "externalPower": None},
            )

    def test_contract_adapter_tray_and_native_composition_are_separated(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        tray = TRAY.read_text(encoding="utf-8")
        shell = SHELL.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")

        self.assertIn('ordax.power-status/1', contract)
        self.assertIn('/__ordax/native/power-status', adapter)
        self.assertIn("assertPowerStatusPort", tray)
        self.assertIn('panel.addEventListener("ordax:quick-panel-open"', tray)
        self.assertIn("quickPercent.textContent", tray)
        self.assertIn("quickState.textContent", tray)
        self.assertIn("quickPower.textContent", tray)
        self.assertIn("data-battery-tray", shell)
        self.assertIn('data-quick-panel-toggle="battery"', shell)
        self.assertIn('data-quick-panel="battery"', shell)
        self.assertIn("data-quick-battery-percent", shell)
        self.assertIn("data-quick-battery-state", shell)
        self.assertIn("data-quick-battery-power", shell)
        self.assertIn(" hidden", shell)
        self.assertIn("createNativePowerStatus", composition)
        self.assertIn("mountBatteryTrayControls", composition)
        self.assertIn('reportClientDiagnostic("battery-tray-status", error)', composition)
        self.assertIn("batteryTrayControls?.destroy()", composition)
        self.assertIn('"power.status"', runtime)
        self.assertNotIn("/__ordax/native/", tray)
        self.assertNotIn("serial", tray.lower())
        self.assertNotIn("model", tray.lower())

    def test_capability_is_native_only_and_read_only(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["power.status"]["security_boundary"],
            "read-only-power-supply-observability",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("power.status", modes["usb"]["baseline_capabilities"])
        self.assertIn("power.status", modes["native-disk"]["baseline_capabilities"])
        for mode in ("web", "mobile", "desktop"):
            self.assertNotIn("power.status", modes[mode]["baseline_capabilities"])

    def test_host_power_status_endpoint_is_loopback_get_only(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn('POWER_STATUS_PATH = "/__ordax/native/power-status"', server)
        self.assertIn("read_power_status()", get_section)
        self.assertIn("POWER_STATUS_PATH", get_section)
        self.assertNotIn("if self.path == POWER_STATUS_PATH", post_section)


if __name__ == "__main__":
    unittest.main()
