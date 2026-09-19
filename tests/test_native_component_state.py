from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_ADAPTER = ROOT / "system" / "adapters" / "native" / "component-state.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
MANIFEST = ROOT / "system" / "contracts" / "component-manifest.mjs"
STATE_STORE = ROOT / "system" / "contracts" / "component-state-store.mjs"
MANAGER_CONTRACT = ROOT / "system" / "contracts" / "component-manager.mjs"
CATALOG = ROOT / "system" / "services" / "components" / "catalog.mjs"
MANAGER = ROOT / "system" / "services" / "components" / "manager.mjs"
SYSTEM_VIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"


def load_host_server():
    spec = spec_from_file_location("ordax_native_component_state_test", HOST_SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativeComponentStateTests(unittest.TestCase):
    def test_component_state_payload_is_bounded_atomic_and_private(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.COMPONENT_STATE_FILE = str(Path(directory) / "component-state.json")
            payload = (
                '{"schema":"ordax.component-state/1","revision":0,"components":{}}'
            )
            self.assertTrue(host.valid_component_state_payload(payload))
            self.assertFalse(
                host.valid_component_state_payload(
                    "x" * (host.MAX_COMPONENT_STATE_PAYLOAD + 1)
                )
            )

            host.write_component_state_payload(payload)
            self.assertEqual(host.read_component_state_payload(), payload)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            mode = stat.S_IMODE(os.stat(host.COMPONENT_STATE_FILE).st_mode)
            self.assertEqual(mode, 0o600)

            host.write_component_state_payload(None)
            self.assertIsNone(host.read_component_state_payload())

    def test_native_host_owns_loopback_component_state_endpoint(self):
        text = HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn(
            'COMPONENT_STATE_PATH = "/__ordax/native/component-state"',
            text,
        )
        self.assertIn(
            'COMPONENT_STATE_FILE = "/var/lib/ordax/component-state.json"',
            text,
        )
        self.assertIn("valid_component_state_payload", text)
        self.assertIn("read_component_state_payload", text)
        self.assertIn("write_component_state_payload", text)
        self.assertIn("if self.path == COMPONENT_STATE_PATH:", text)
        self.assertNotIn("Access-Control-Allow-Origin", text)

    def test_component_manager_preserves_platform_boundaries(self):
        manifest = MANIFEST.read_text(encoding="utf-8")
        state = STATE_STORE.read_text(encoding="utf-8")
        contract = MANAGER_CONTRACT.read_text(encoding="utf-8")
        catalog = CATALOG.read_text(encoding="utf-8")
        manager = MANAGER.read_text(encoding="utf-8")
        adapter = NATIVE_ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_MAIN.read_text(encoding="utf-8")
        web = WEB_MAIN.read_text(encoding="utf-8")
        view = SYSTEM_VIEW.read_text(encoding="utf-8")

        self.assertIn('ordax.component-manifest/1', manifest)
        self.assertIn('"base-ab"', manifest)
        self.assertIn('"component-slot"', manifest)
        self.assertIn('"bundled"', manifest)
        self.assertIn("dependency cycle", manifest)
        self.assertIn('ordax.component-state/1', state)
        self.assertIn('ordax.component-manager/1', contract)
        self.assertIn("listFirstPartyApps", catalog)
        self.assertIn("app.component", catalog)
        self.assertIn("stageCandidate", manager)
        self.assertIn("markPendingHealthy", manager)
        self.assertIn("promotePending", manager)
        self.assertIn("rollback", manager)
        self.assertIn("individual slot operations are forbidden", manager)
        self.assertNotIn("localStorage", manager)
        self.assertNotIn("/__ordax/native/", manager)

        self.assertIn(
            'COMPONENT_STATE_ENDPOINT = "/__ordax/native/component-state"',
            adapter,
        )
        self.assertIn("createNativeComponentStateStore", native)
        self.assertIn("createComponentManager", native)
        self.assertIn("listSystemComponents", native)
        self.assertIn("componentManager.destroy()", native)
        self.assertIn("createComponentManager", web)
        self.assertNotIn("createNativeComponentStateStore", web)

        self.assertIn("assertComponentManager", view)
        self.assertIn('"Slot independente"', view)
        self.assertIn('"Distribuição conjunta"', view)
        self.assertIn("rollback individual permanece bloqueado", view)


if __name__ == "__main__":
    unittest.main()
