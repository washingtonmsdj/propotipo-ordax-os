from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "update-status.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
HISTORY_CONTRACT = ROOT / "system" / "contracts" / "update-history.mjs"
HISTORY_ADAPTER = ROOT / "system" / "adapters" / "native" / "update-history.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web" / "main.mjs"
SYSTEM_APP = ROOT / "system" / "apps" / "system" / "app.mjs"
SYSTEM_CSS = ROOT / "system" / "surface" / "ui" / "system.css"
UPDATE_PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"


class SystemRuntimeStatusTests(unittest.TestCase):
    def test_update_status_has_neutral_contract(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.update-status/1', contract)
        self.assertIn("validateUpdateStatusSnapshot", contract)
        self.assertIn("assertUpdateStatusPort", contract)
        self.assertIn("targetSha", contract)
        self.assertIn("phase", contract)
        self.assertIn("attemptId", contract)
        self.assertIn("lastError", contract)
        self.assertIn("deliveryNumber", contract)
        self.assertIn("versionNumber", contract)
        self.assertIn("lastApplyDurationSeconds", contract)
        self.assertIn("lastStageDurationSeconds", contract)
        self.assertIn("UPDATE_STATUS_SCHEMA", adapter)
        self.assertIn("validateUpdateStatusSnapshot", adapter)
        self.assertIn("schema: UPDATE_STATUS_SCHEMA", adapter)

    def test_shared_system_overview_uses_only_neutral_ports(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        system_app = SYSTEM_APP.read_text(encoding="utf-8")
        css = SYSTEM_CSS.read_text(encoding="utf-8")
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")

        self.assertIn("contracts/update-status.mjs", controls)
        self.assertIn("contracts/update-history.mjs", controls)
        self.assertIn("contracts/system-metrics.mjs", controls)
        self.assertIn("contracts/surface-host.mjs", controls)
        self.assertIn("contracts/app-activation.mjs", controls)
        self.assertIn("services/update/presentation.mjs", controls)
        self.assertIn("./surface-lifecycle.mjs", controls)
        self.assertIn('[data-app-extension="system-overview"]', controls)
        self.assertIn("Entrega observada", controls)
        self.assertIn("Entrega e recuperação", controls)
        self.assertIn("Histórico de atualizações", controls)
        self.assertIn("Identidade da entrega", controls)
        self.assertIn("Distribuição conjunta · sem versão própria", controls)
        self.assertIn("não é número de PR nem versão comercial do OrdaX", controls)
        self.assertIn("America/Bahia", presentation)
        self.assertIn("Capacidades desta execução", controls)
        self.assertIn('kind: "extension"', system_app)
        self.assertIn('extensionId: "system-overview"', system_app)
        self.assertIn(".ordax-system-view", css)
        self.assertIn(".ordax-system-navigation", css)
        self.assertIn('id: "updates"', controls)
        self.assertIn('id: "storage"', controls)
        self.assertIn('id: "diagnostics"', controls)
        self.assertIn('id: "about"', controls)
        self.assertIn("data.systemSection", controls.replace("dataset", "data"))
        self.assertIn('health.dataset.state =', controls)
        self.assertIn('"observed"', controls)
        self.assertIn("updateStatusLabel(updateSnapshot.status)", controls)
        self.assertNotIn('"Operando normalmente"', controls)
        self.assertNotIn('data-state="healthy"', css)
        self.assertNotIn("MutationObserver", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("fetch(", controls)

    def test_native_composition_reuses_one_update_watcher_and_one_system_view(self):
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertEqual(composition.count("createNativeUpdateWatcher(window)"), 1)
        self.assertIn("mountSystemOverviewControls(", composition)
        self.assertIn("root,\n    host,\n    updateWatcher,\n    systemMetrics,\n    surface,\n    updateHistory,\n    appActivation,", composition)
        self.assertIn("createNativeUpdateHistory(window)", composition)
        self.assertIn("mountUpdateControls(root, updateWatcher, appActivation)", composition)
        self.assertIn("systemOverviewControls.destroy()", composition)
        self.assertNotIn("mountSystemStatusControls", composition)
        self.assertNotIn("mountSystemMetricsControls", composition)

    def test_update_history_has_neutral_read_only_contract(self):
        contract = HISTORY_CONTRACT.read_text(encoding="utf-8")
        adapter = HISTORY_ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.update-history/1', contract)
        self.assertIn("assertUpdateHistoryPort", contract)
        self.assertIn("validateUpdateHistorySnapshot", contract)
        self.assertIn('UPDATE_HISTORY_ENDPOINT = "/__ordax/native/update-history"', adapter)
        self.assertIn("async list()", adapter)
        self.assertNotIn('method: "POST"', adapter)

    def test_web_mounts_same_system_overview_without_native_ports(self):
        composition = WEB_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("mountSystemOverviewControls(", composition)
        self.assertIn("root,\n  host,\n  null,\n  null,\n  surface,\n  null,\n  appActivation,", composition)
        self.assertIn("systemOverviewControls.destroy()", composition)
        self.assertNotIn("adapters/native", composition)


if __name__ == "__main__":
    unittest.main()
