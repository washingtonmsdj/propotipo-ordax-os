from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "update-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "system-status-controls.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class SystemRuntimeStatusTests(unittest.TestCase):
    def test_update_status_has_neutral_contract(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.update-status/1', contract)
        self.assertIn("validateUpdateStatusSnapshot", contract)
        self.assertIn("assertUpdateStatusPort", contract)
        self.assertIn("UPDATE_STATUS_SCHEMA", adapter)
        self.assertIn("validateUpdateStatusSnapshot", adapter)
        self.assertIn("schema: UPDATE_STATUS_SCHEMA", adapter)

    def test_shared_system_panel_does_not_depend_on_native_adapter(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("contracts/update-status.mjs", controls)
        self.assertIn('[data-window-id=\"system\"]', controls)
        self.assertIn("Commit em execução", controls)
        self.assertIn("Reinício físico pendente", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("fetch(", controls)

    def test_native_composition_reuses_one_update_watcher(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertEqual(composition.count("createNativeUpdateWatcher(window)"), 1)
        self.assertIn("mountSystemStatusControls(root, updateWatcher)", composition)
        self.assertIn("mountUpdateControls(root, updateWatcher)", composition)
        self.assertIn("systemStatusControls.destroy()", composition)


if __name__ == "__main__":
    unittest.main()
