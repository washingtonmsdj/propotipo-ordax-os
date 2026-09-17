from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "workspace-store.mjs"
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"
STATE = ROOT / "system" / "surface" / "ui" / "surface-state.mjs"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "workspace.mjs"
NATIVE_ADAPTER = ROOT / "system" / "adapters" / "native" / "workspace.mjs"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web" / "main.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class WorkspacePersistenceContractTests(unittest.TestCase):
    def test_shared_surface_consumes_neutral_workspace_contract(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        surface = SURFACE.read_text(encoding="utf-8")
        state = STATE.read_text(encoding="utf-8")
        self.assertIn('WORKSPACE_STORE_SCHEMA = "ordax.workspace-store/1"', contract)
        self.assertIn("assertWorkspaceStore", surface)
        self.assertIn("createWorkspaceSnapshot", surface)
        self.assertIn("validateWorkspaceRecord", state)
        self.assertNotIn("adapters/native", surface)
        self.assertNotIn("adapters/web", surface)
        self.assertNotIn("localStorage", surface)
        self.assertNotIn("localStorage", state)

    def test_compositions_choose_mode_specific_workspace_adapters(self):
        web = WEB_COMPOSITION.read_text(encoding="utf-8")
        native = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('../../adapters/web/workspace.mjs', web)
        self.assertIn("createWebWorkspaceStore", web)
        self.assertIn("workspaceStore,", web)
        self.assertIn('../../adapters/native/workspace.mjs', native)
        self.assertIn("createNativeWorkspaceStore", native)
        self.assertIn("workspaceStore,", native)
        self.assertNotIn('../../adapters/native/workspace.mjs', web)
        self.assertNotIn('../../adapters/web/workspace.mjs', native)

    def test_browser_backed_stores_are_bounded_and_namespaced(self):
        web = WEB_ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_ADAPTER.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('"ordax.workspace.v1"', web)
        self.assertIn('"ordax.native.workspace.v1"', native)
        self.assertIn("validateWorkspaceRecord", web)
        self.assertIn("validateWorkspaceRecord", native)
        self.assertIn("MAX_WINDOWS = 32", contract)
        self.assertIn("MAX_COORDINATE = 1_000_000", contract)
        self.assertNotIn("fetch(", native)

    def test_only_durable_workspace_actions_are_persisted(self):
        surface = SURFACE.read_text(encoding="utf-8")
        for action in (
            "app.launch",
            "window.focus",
            "window.move",
            "window.minimize",
            "window.maximize",
            "window.close",
            "workspace.show-desktop",
        ):
            self.assertIn(f'"{action}"', surface)
        self.assertNotIn('"launcher.toggle",\n  "launcher.close"', surface)


if __name__ == "__main__":
    unittest.main()
