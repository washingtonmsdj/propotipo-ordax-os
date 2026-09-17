from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import math
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_PREFERENCES = ROOT / "system" / "adapters" / "native" / "preferences.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


def load_host_server():
    spec = spec_from_file_location("ordax_native_host_server_test", HOST_SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativePreferenceTests(unittest.TestCase):
    def test_host_validates_same_scalar_preference_shape(self):
        host = load_host_server()
        self.assertTrue(host.valid_preference_record({"appearance.theme": "dark"}))
        self.assertTrue(host.valid_preference_record({"feature.enabled": True, "count.value": 2}))
        self.assertFalse(host.valid_preference_record({"Appearance.Theme": "dark"}))
        self.assertFalse(host.valid_preference_record({"nested.value": {"bad": True}}))
        self.assertFalse(host.valid_preference_record({"list.value": [1, 2]}))
        self.assertFalse(host.valid_preference_record({"number.value": math.nan}))

    def test_host_preference_write_is_atomic_and_round_trips(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.PREFERENCES_FILE = str(Path(directory) / "preferences.json")
            expected = {"appearance.theme": "light", "feature.enabled": False}
            host.write_preferences(expected)
            self.assertEqual(host.read_preferences(), expected)
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))

    def test_native_adapter_uses_loopback_state_endpoint(self):
        text = NATIVE_PREFERENCES.read_text(encoding="utf-8")
        self.assertIn('PREFERENCES_ENDPOINT = "/__ordax/native/preferences"', text)
        self.assertIn("validatePreferenceRecord", text)
        self.assertIn("assertPreferenceStore", text)
        self.assertIn("persistQueue", text)
        self.assertIn('method: "GET"', text)
        self.assertIn('method: "POST"', text)
        self.assertNotIn("localStorage", text)

    def test_native_state_is_outside_replaceable_runtime(self):
        text = SURFACE_LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('PERSISTENT_NATIVE_STATE=$STATE_ROOT/native-state', text)
        self.assertIn('mount -o bind "$PERSISTENT_NATIVE_STATE" "$RUNTIME_ROOT/var/lib/ordax"', text)
        self.assertIn('umount "$RUNTIME_ROOT/var/lib/ordax"', text)
        self.assertIn("STATE_BOUND=1", text)

    def test_native_composition_no_longer_uses_web_preference_store(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('../../adapters/native/preferences.mjs', text)
        self.assertIn("await createNativePreferenceStore(window)", text)
        self.assertNotIn('../../adapters/web/preferences.mjs', text)
        self.assertNotIn("createWebPreferenceStore", text)

    def test_native_host_preferences_remain_loopback_and_no_cors(self):
        text = HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('PREFERENCES_PATH = "/__ordax/native/preferences"', text)
        self.assertIn('PREFERENCES_FILE = "/var/lib/ordax/preferences.json"', text)
        self.assertIn('if self.client_address[0] != "127.0.0.1"', text)
        self.assertNotIn("Access-Control-Allow-Origin", text)


if __name__ == "__main__":
    unittest.main()
