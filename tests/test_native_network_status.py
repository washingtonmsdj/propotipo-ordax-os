import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "network-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "network-status.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_network_status_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeNetworkStatusTests(unittest.TestCase):
    def test_wireless_signal_parser_is_bounded_and_ignores_invalid_values(self):
        signals = native_host.parse_wireless_signals(
            "Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE\n"
            " face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22\n"
            " wlan0: 0000   70.  -42.  -256        0      0      0      0      0        0\n"
            " wlan1: 0000   60.   35.  -256        0      0      0      0      0        0\n"
        )
        self.assertEqual(signals, {"wlan0": -42})

    def test_reader_reports_only_bounded_interface_observability(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sys_net = root / "sys" / "class" / "net"
            proc_wireless = root / "proc" / "net" / "wireless"
            sys_net.mkdir(parents=True)
            proc_wireless.parent.mkdir(parents=True)

            for name, net_type, carrier, operstate, wifi in (
                ("wlan0", "1", "1", "up", True),
                ("eth0", "1", "0", "down", False),
                ("tun0", "65534", "", "unknown", False),
                ("lo", "772", "1", "unknown", False),
            ):
                path = sys_net / name
                path.mkdir()
                (path / "type").write_text(net_type + "\n", encoding="utf-8")
                if carrier:
                    (path / "carrier").write_text(carrier + "\n", encoding="utf-8")
                (path / "operstate").write_text(operstate + "\n", encoding="utf-8")
                if wifi:
                    (path / "wireless").mkdir()

            proc_wireless.write_text(
                "Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE\n"
                " face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22\n"
                " wlan0: 0000   70.  -51.  -256        0      0      0      0      0        0\n",
                encoding="utf-8",
            )

            snapshot = native_host.read_network_status(str(sys_net), str(proc_wireless))
            self.assertEqual(
                snapshot,
                {
                    "interfaces": [
                        {"name": "eth0", "kind": "ethernet", "state": "disconnected", "signalDbm": None},
                        {"name": "tun0", "kind": "other", "state": "unknown", "signalDbm": None},
                        {"name": "wlan0", "kind": "wifi", "state": "connected", "signalDbm": -51},
                    ]
                },
            )
            flattened = json.dumps(snapshot)
            for forbidden in ("mac", "address", "ssid", "bssid", "password", "psk"):
                self.assertNotIn(forbidden, flattened.lower())

    def test_contract_adapter_composition_and_shared_ui_stay_separated(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        controls = CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")

        self.assertIn('ordax.network-status/1', contract)
        self.assertIn("validateNetworkStatusSnapshot", contract)
        self.assertIn('/__ordax/native/network-status', adapter)
        self.assertIn("await port.read()", adapter)
        self.assertIn("contracts/network-status.mjs", controls)
        self.assertIn('"Rede e conexões"', controls)
        self.assertIn('"Somente leitura"', controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertIn("createNativeNetworkStatus", composition)
        self.assertIn("networkStatusAvailable", composition)
        self.assertIn('"network.status"', runtime)

    def test_capability_is_native_only_and_read_only(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["network.status"]["security_boundary"],
            "read-only-local-network-observability",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("network.status", modes["usb"]["baseline_capabilities"])
        self.assertIn("network.status", modes["native-disk"]["baseline_capabilities"])
        self.assertNotIn("network.status", modes["web"]["baseline_capabilities"])
        self.assertNotIn("network.status", modes["mobile"]["baseline_capabilities"])
        self.assertNotIn("network.status", modes["desktop"]["baseline_capabilities"])

    def test_host_network_endpoint_is_loopback_get_only(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('NETWORK_STATUS_PATH = "/__ordax/native/network-status"', server)
        self.assertIn("read_network_status()", server)
        self.assertIn("NETWORK_STATUS_PATH", server.split("def do_GET", 1)[1].split("def do_POST", 1)[0])
        self.assertNotIn("if self.path == NETWORK_STATUS_PATH", server.split("def do_POST", 1)[1])


if __name__ == "__main__":
    unittest.main()
