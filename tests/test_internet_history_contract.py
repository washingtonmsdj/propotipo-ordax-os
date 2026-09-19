from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "internet-browser-controls.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "internet.css"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
CONTRACT = ROOT / "system" / "contracts" / "browser-history.mjs"
STORE = ROOT / "system" / "contracts" / "browser-history-store.mjs"
RUNTIME = ROOT / "system" / "services" / "internet" / "history.mjs"
BRIDGE = ROOT / "system" / "services" / "internet" / "history-bridge.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "browser-history.mjs"


class InternetHistoryContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_shared_ui_uses_only_neutral_history_port(self):
        controls = self.text(CONTROLS)
        self.assertIn('contracts/browser-history.mjs', controls)
        self.assertIn('assertBrowserHistoryPort', controls)
        self.assertIn('history = null', controls)
        self.assertIn('historyPort.remove(', controls)
        self.assertIn('historyPort.clear()', controls)
        self.assertIn('dataset.browserHistoryToggle', controls)
        self.assertIn('dataset.browserOpenHistory', controls)
        self.assertIn('dataset.browserClearHistory', controls)
        self.assertNotIn('localStorage', controls)
        self.assertNotIn('sessionStorage', controls)
        self.assertNotIn('/__ordax/native/', controls)

    def test_native_composition_owns_history_storage_runtime_and_bridge(self):
        native = self.text(NATIVE_MAIN)
        self.assertIn('createNativeBrowserHistoryStore', native)
        self.assertIn('createBrowserHistoryRuntime', native)
        self.assertIn('createBrowserHistoryBridge', native)
        self.assertIn('history: browserHistory', native)
        self.assertIn('browserHistoryBridge.destroy()', native)
        self.assertIn('browserHistory.destroy()', native)

    def test_web_composition_does_not_fake_native_browser_history(self):
        web = self.text(WEB_MAIN)
        self.assertNotIn('createNativeBrowserHistoryStore', web)
        self.assertNotIn('createBrowserHistoryRuntime', web)
        self.assertNotIn('createBrowserHistoryBridge', web)
        self.assertIn('mountInternetBrowserControls(root, browserSession, surface)', web)

    def test_history_has_bounded_independent_contract_and_privileged_store(self):
        contract = self.text(CONTRACT)
        store = self.text(STORE)
        runtime = self.text(RUNTIME)
        bridge = self.text(BRIDGE)
        adapter = self.text(ADAPTER)
        self.assertIn('BROWSER_HISTORY_SCHEMA = "ordax.browser-history/1"', contract)
        self.assertIn('MAX_BROWSER_HISTORY_ENTRIES = 512', contract)
        self.assertIn('BROWSER_HISTORY_STORE_SCHEMA = "ordax.browser-history-store/1"', store)
        self.assertIn('[entry, ...state.entries].slice(0, MAX_BROWSER_HISTORY_ENTRIES)', runtime)
        self.assertIn('tab.loading || !url', bridge)
        self.assertIn('ordax.native.browser-history.v1', adapter)
        self.assertNotIn('projectId', contract)
        self.assertNotIn('projectId', runtime)

    def test_history_controls_are_real_and_accessible(self):
        controls = self.text(CONTROLS)
        css = self.text(CSS)
        self.assertIn('"NAVEGAÇÃO"', controls)
        self.assertIn('"Histórico"', controls)
        self.assertIn('"Limpar"', controls)
        self.assertIn('aria-expanded', controls)
        self.assertIn('aria-label', controls)
        self.assertIn('ordax-internet-history-list', css)
        self.assertIn('ordax-internet-history-open', css)
        self.assertIn('ordax-internet-history-remove', css)
        self.assertNotIn('Histórico"))\n  footer', controls)


if __name__ == "__main__":
    unittest.main()
