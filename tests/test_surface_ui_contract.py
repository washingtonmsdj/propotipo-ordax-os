from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
APPS = ROOT / "system" / "apps"
APP_CATALOG = APPS / "catalog.mjs"
APP_CONTRACT = APPS / "app-contract.mjs"
APP_OWNERS = {
    "files": APPS / "files" / "app.mjs",
    "settings": APPS / "settings" / "app.mjs",
    "account": APPS / "account" / "app.mjs",
    "system": APPS / "system" / "app.mjs",
}
COMPOSITION = ROOT / "system" / "composition" / "web"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
HOST_CONTRACT = ROOT / "system" / "contracts" / "surface-host.mjs"
WEB_WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class SurfaceUiContractTests(unittest.TestCase):
    def test_visual_surface_and_app_sources_exist(self):
        for path in (
            SURFACE / "surface.mjs",
            SURFACE / "surface-state.mjs",
            SURFACE / "tokens.css",
            SURFACE / "surface.css",
            APP_CATALOG,
            APP_CONTRACT,
            *APP_OWNERS.values(),
            COMPOSITION / "index.html",
            COMPOSITION / "main.mjs",
            WEB_ADAPTER,
            HOST_CONTRACT,
        ):
            self.assertTrue(path.is_file(), path)
            self.assertGreater(path.stat().st_size, 0, path)

    def test_shared_surface_never_imports_concrete_adapter(self):
        for path in SURFACE.rglob("*.mjs"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("adapters/", text, path)
            self.assertNotIn("navigator.", text, path)
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn("contracts/surface-host.mjs", surface)
        self.assertIn("../../apps/catalog.mjs", surface)

    def test_first_party_apps_have_independent_owners_and_thin_catalog(self):
        catalog = APP_CATALOG.read_text(encoding="utf-8")
        self.assertIn("./app-contract.mjs", catalog)
        for app_id, path in APP_OWNERS.items():
            owner = path.read_text(encoding="utf-8")
            self.assertIn(f'id: "{app_id}"', owner)
            self.assertIn("defineFirstPartyApp", owner)
            self.assertIn(f'./{app_id}/app.mjs', catalog)
        self.assertIn("listFirstPartyApps", catalog)
        self.assertIn("getFirstPartyApp", catalog)
        self.assertLess(len(catalog.splitlines()), 40, "catalog should stay composition-only")

    def test_app_contract_is_capability_driven_and_fail_closed(self):
        text = APP_CONTRACT.read_text(encoding="utf-8")
        self.assertIn("requiredCapabilities", text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("every((capabilityId)", text)
        self.assertIn("PANEL_KINDS", text)

    def test_app_source_is_platform_neutral(self):
        for path in APPS.rglob("*.mjs"):
            text = path.read_text(encoding="utf-8")
            for forbidden in (
                "adapters/web",
                "adapters/mobile",
                "adapters/desktop",
                "adapters/native",
                "navigator.",
                "window.",
            ):
                self.assertNotIn(forbidden, text, path)

    def test_workspace_state_has_real_window_lifecycle_without_platform_branching(self):
        text = (SURFACE / "surface-state.mjs").read_text(encoding="utf-8")
        for action in (
            'case "app.launch"',
            'case "window.focus"',
            'case "window.minimize"',
            'case "window.maximize"',
            'case "window.close"',
            'case "workspace.show-desktop"',
        ):
            self.assertIn(action, text)
        self.assertIn("isAppAvailable", text)
        self.assertNotIn("platform", text.lower())
        self.assertNotIn("navigator.", text)

    def test_web_composition_is_wiring_not_visual_fork(self):
        main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn("../../surface/ui/surface.mjs", main)
        self.assertIn("../../adapters/web/runtime.mjs", main)
        self.assertIn("../../surface/ui/tokens.css", html)
        self.assertIn("../../surface/ui/surface.css", html)
        self.assertNotIn("<style", html.lower())

    def test_visual_surface_has_no_remote_asset_or_runtime_dependency(self):
        for path in list(SURFACE.rglob("*")) + list(APPS.rglob("*")) + list(COMPOSITION.rglob("*")):
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            self.assertNotIn("http://", text, path)
            self.assertNotIn("https://", text, path)
            self.assertNotIn("cdn.", text.lower(), path)

    def test_web_adapter_exposes_host_contract_not_shared_ui(self):
        text = WEB_ADAPTER.read_text(encoding="utf-8")
        self.assertIn("contracts/surface-host.mjs", text)
        self.assertIn('"network.https"', text)
        self.assertNotIn("surface/ui", text)
        self.assertNotIn("innerHTML", text)

    def test_surface_baseline_is_accessible_responsive_and_windowed(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        self.assertIn('aria-live="polite"', surface)
        self.assertIn('aria-label="Controles da Surface"', surface)
        self.assertIn('role="menu"', surface)
        self.assertIn("data-window-layer", surface)
        self.assertIn('event.key === "Escape"', surface)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('.ordax-window[data-maximized="true"]', css)

    def test_web_candidate_rebuilds_when_shared_apps_change(self):
        workflow = WEB_WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("'system/apps/**'"), 2)


if __name__ == "__main__":
    unittest.main()
