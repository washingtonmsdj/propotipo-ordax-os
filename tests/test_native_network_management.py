import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
BROKER = ROOT / "system" / "surface" / "runtime" / "network_broker.sh"
CONTRACT = ROOT / "system" / "contracts" / "network-management.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "network-management.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
SETTINGS_CONTROLS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
QUICK_CONTROLS = ROOT / "system" / "surface" / "ui" / "network-quick-panel.mjs"
NETWORK_RUNTIME = ROOT / "system" / "services" / "network" / "management-runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_network_management_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeNetworkManagementTests(unittest.TestCase):
    def test_wpa_psk_is_derived_locally_without_returning_password(self):
        expected = hashlib.pbkdf2_hmac(
            "sha1",
            b"password",
            b"IEEE",
            4096,
            dklen=32,
        ).hex()
        self.assertEqual(native_host.derive_wpa_psk("IEEE", "password"), expected)
        self.assertEqual(
            expected,
            "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e",
        )

    def test_wifi_input_limits_match_real_ssid_and_passphrase_bounds(self):
        self.assertTrue(native_host.valid_wifi_ssid("Rede de casa"))
        self.assertTrue(native_host.valid_wifi_ssid("á" * 16))
        self.assertFalse(native_host.valid_wifi_ssid("á" * 17))
        self.assertFalse(native_host.valid_wifi_ssid("x" * 33))
        self.assertFalse(native_host.valid_wifi_ssid("rede\nquebrada"))
        self.assertTrue(native_host.valid_wifi_password("12345678"))
        self.assertTrue(native_host.valid_wifi_password("x" * 63))
        self.assertFalse(native_host.valid_wifi_password("x" * 7))
        self.assertFalse(native_host.valid_wifi_password("x" * 64))
        self.assertFalse(native_host.valid_wifi_password("senha\nindevida"))

    def test_scan_parser_keeps_only_supported_psk_networks_and_strongest_bss(self):
        scan = (
            "BSS aa:aa:aa:aa:aa:01(on wlan0)\n"
            "\tsignal: -68.00 dBm\n"
            "\tSSID: Casa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: PSK\n"
            "BSS aa:aa:aa:aa:aa:02(on wlan0)\n"
            "\tsignal: -41.00 dBm\n"
            "\tSSID: Casa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: PSK\n"
            "BSS bb:bb:bb:bb:bb:01(on wlan0)\n"
            "\tsignal: -55.00 dBm\n"
            "\tSSID: Aberta\n"
            "BSS cc:cc:cc:cc:cc:01(on wlan0)\n"
            "\tsignal: -60.00 dBm\n"
            "\tSSID: Empresa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: 802.1X\n"
        )
        networks = native_host.parse_iw_scan(
            scan,
            current_ssid="Casa",
            saved_ssid="Casa",
        )
        self.assertEqual(
            networks,
            [
                {
                    "ssid": "Casa",
                    "signalDbm": -41,
                    "security": "wpa-psk",
                    "connected": True,
                    "saved": True,
                }
            ],
        )

    def test_snapshot_reads_only_ssid_state_and_never_secret_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = native_host.network_broker_paths(str(root))
            Path(paths["link"]).write_text(
                "Connected to aa:bb:cc:dd:ee:ff (on wlan0)\n"
                "\tSSID: Casa\n"
                "\tsignal: -44 dBm\n",
                encoding="utf-8",
            )
            Path(paths["saved"]).write_text(
                "ssid=" + "Casa".encode("utf-8").hex() + "\n",
                encoding="utf-8",
            )
            Path(paths["scan"]).write_text(
                "BSS aa:bb:cc:dd:ee:ff(on wlan0)\n"
                "\tsignal: -44.00 dBm\n"
                "\tSSID: Casa\n"
                "\tRSN:\n"
                "\t\tAuthentication suites: PSK\n",
                encoding="utf-8",
            )
            snapshot = native_host.build_network_management_snapshot(paths, "wlan0")
            self.assertEqual(snapshot["currentSsid"], "Casa")
            self.assertEqual(snapshot["savedSsid"], "Casa")
            flattened = json.dumps(snapshot).lower()
            for forbidden in ("password", "passphrase", "psk=", "secret"):
                self.assertNotIn(forbidden, flattened)

    def test_broker_is_shell_valid_private_and_has_no_secret_logging(self):
        subprocess.run(["sh", "-n", str(BROKER)], check=True)
        text = BROKER.read_text(encoding="utf-8")
        self.assertIn('chmod 600 "$CONTROL"', text)
        self.assertIn('chmod 600 "$CANDIDATE"', text)
        self.assertIn('psk=%s', text)
        self.assertIn('rm -f "$CANDIDATE"', text)
        self.assertIn('restore_saved_network "$wifi"', text)
        self.assertNotIn("set -x", text)
        self.assertNotIn('echo "$psk_hex"', text)
        self.assertNotIn('echo "$ssid_hex"', text)
        self.assertNotIn("logger", text)

    def test_native_api_is_loopback_tokenized_serialized_and_no_shell_endpoint(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn('NETWORK_MANAGEMENT_PATH = "/__ordax/native/network-management"', server)
        self.assertIn('NETWORK_TOKEN_HEADER = "X-OrdaX-Network-Token"', server)
        self.assertIn("self.network_token = secrets.token_urlsafe(32)", server)
        self.assertIn("self.network_lock = threading.Lock()", server)
        self.assertIn("SESSION_PATH", get_section)
        self.assertIn("NETWORK_MANAGEMENT_PATH", get_section)
        self.assertIn("networkToken", get_section)
        self.assertIn("queue_network_broker_request", get_section)
        self.assertIn("if self.path == NETWORK_MANAGEMENT_PATH", post_section)
        self.assertIn("with self.server.network_lock:", post_section)
        self.assertNotIn("subprocess", server)
        self.assertNotIn("os.system", server)
        self.assertNotIn("/bin/sh -c", server)

    def test_capability_is_native_only_and_composition_probes_fail_soft(self):
        capabilities = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in capabilities["capabilities"]}
        self.assertEqual(
            entries["network.management"]["security_boundary"],
            "loopback-token-host-network-broker",
        )
        modes = {mode["id"]: mode for mode in capabilities["modes"]}
        self.assertIn("network.management", modes["usb"]["baseline_capabilities"])
        self.assertIn("network.management", modes["native-disk"]["baseline_capabilities"])
        for mode in ("web", "mobile", "desktop"):
            self.assertNotIn("network.management", modes[mode]["baseline_capabilities"])

        composition = COMPOSITION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createNativeNetworkManagement", composition)
        self.assertIn("networkManagement = null", composition)
        self.assertIn("networkManagementAvailable", composition)
        self.assertIn('"network.management"', runtime)

    def test_settings_ui_consumes_neutral_port_and_keeps_password_ephemeral(self):
        controls = SETTINGS_CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("contracts/network-management.mjs", controls)
        self.assertIn("assertNetworkManagementPort", controls)
        self.assertIn('"Procurar redes"', controls)
        self.assertIn('"Conectar"', controls)
        self.assertIn('"Desconectar"', controls)
        self.assertIn('"Esquecer"', controls)
        self.assertIn('"Reconectar"', controls)
        self.assertIn('input.type = "password"', controls)
        self.assertIn('input.autocomplete = "off"', controls)
        self.assertIn('input.value = ""', controls)
        self.assertIn('let password = input.value', controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertNotIn("/__ordax/native/network-management", controls)
        self.assertNotIn("networkPassword", controls)
        self.assertIn("networkManagement,", composition)

    def test_quick_wifi_panel_reuses_neutral_owner_and_keeps_password_ephemeral(self):
        controls = QUICK_CONTROLS.read_text(encoding="utf-8")
        runtime = NETWORK_RUNTIME.read_text(encoding="utf-8")
        settings = SETTINGS_CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("contracts/network-management.mjs", controls)
        self.assertIn("contracts/network-status.mjs", controls)
        self.assertIn("services/network/management-runtime.mjs", controls)
        self.assertIn("services/network/management-runtime.mjs", settings)
        self.assertIn("assertNetworkManagementPort", controls)
        self.assertIn("assertNetworkStatusPort", controls)
        for action in ("scan", "connect", "disconnect", "forget", "reconnect"):
            self.assertIn(f'case "{action}"', runtime)
        self.assertNotIn('data-quick-network-action="forget"', controls)
        self.assertIn('input.type = "password"', controls)
        self.assertIn('input.autocomplete = "off"', controls)
        self.assertIn('input.value = ""', controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertIn("mountNetworkQuickPanel(root, networkStatus, networkManagement)", composition)
        self.assertIn('reportClientDiagnostic("network-quick-panel", error)', composition)

    def test_native_composition_recovers_if_optional_wifi_settings_mount_fails(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeClientDiagnostics", composition)
        self.assertIn('reportClientDiagnostic("settings-network-management", error)', composition)
        self.assertIn("let settingsOverviewControls;", composition)
        self.assertIn("networkStatus,\n      networkManagement,", composition)
        self.assertIn("networkStatus,\n      null,", composition)
        self.assertLess(
            composition.index('reportClientDiagnostic("settings-network-management", error)'),
            composition.index("void updateWatcher.markHealthy()"),
        )

    def test_contract_and_adapter_do_not_expose_generic_command_execution(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.network-management/1', contract)
        for action in ("status", "scan", "connect", "disconnect", "forget", "reconnect"):
            self.assertIn(action, contract)
        self.assertIn('X-OrdaX-Network-Token', adapter)
        self.assertIn('/__ordax/native/network-management', adapter)
        for forbidden in ("shell", "command", "exec(", "terminal"):
            self.assertNotIn(forbidden, (contract + adapter).lower())


if __name__ == "__main__":
    unittest.main()
