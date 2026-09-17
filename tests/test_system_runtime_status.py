from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "update-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web" / "main.mjs"
SYSTEM_APP = ROOT / "system" / "apps" / "system" / "app.mjs"
SYSTEM_CSS = ROOT / "system" / "surface" / "ui" / "system.css"


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

    def test_shared_system_overview_uses_only_neutral_ports(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        system_app = SYSTEM_APP.read_text(encoding="utf-8")
        css = SYSTEM_CSS.read_text(encoding="utf-8")

        self.assertIn("contracts/update-status.mjs", controls)
        self.assertIn("contracts/system-metrics.mjs", controls)
        self.assertIn("contracts/surface-host.mjs", controls)
        self.assertIn("./surface-lifecycle.mjs", controls)
        self.assertIn('[data-app-extension="system-overview"]', controls)
        self.assertIn("Versão em execução", controls)
        self.assertIn("Entrega e recuperação", controls)
        self.assertIn("Capacidades desta execução", controls)
        self.assertIn('kind: "extension"', system_app)
        self.assertIn('extensionId: "system-overview"', system_app)
        self.assertIn(".ordax-system-view", css)
        self.assertNotIn("MutationObserver", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("fetch(", controls)

    def test_native_composition_reuses_one_update_watcher_and_one_system_view(self):
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertEqual(composition.count("createNativeUpdateWatcher(window)"), 1)
        self.assertIn("mountSystemOverviewControls(", composition)
        self.assertIn("root,\n    host,\n    updateWatcher,\n    systemMetrics,\n    surface,", composition)
        self.assertIn("mountUpdateControls(root, updateWatcher)", composition)
        self.assertIn("systemOverviewControls.destroy()", composition)
        self.assertNotIn("mountSystemStatusControls", composition)
        self.assertNotIn("mountSystemMetricsControls", composition)

    def test_web_mounts_same_system_overview_without_native_ports(self):
        composition = WEB_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("mountSystemOverviewControls(", composition)
        self.assertIn("root,\n  host,\n  null,\n  null,\n  surface,", composition)
        self.assertIn("systemOverviewControls.destroy()", composition)
        self.assertNotIn("adapters/native", composition)


if __name__ == "__main__":
    unittest.main()
