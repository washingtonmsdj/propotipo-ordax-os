from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
APPS = ROOT / "system" / "apps"
PREFERENCES = ROOT / "system" / "services" / "preferences"
APP_CATALOG = APPS / "catalog.mjs"
APP_CONTRACT = APPS / "app-contract.mjs"
APP_OWNERS = {
    "files": APPS / "files" / "app.mjs",
    "settings": APPS / "settings" / "app.mjs",
    "account": APPS / "account" / "app.mjs",
    "system": APPS / "system" / "app.mjs",
}
APPEARANCE = PREFERENCES / "appearance.mjs"
PREFERENCE_CATALOG = PREFERENCES / "catalog.mjs"
PREFERENCE_STORE_CONTRACT = ROOT / "system" / "contracts" / "preference-store.mjs"
IDENTITY_SESSION_CONTRACT = ROOT / "system" / "contracts" / "identity-session.mjs"
IDENTITY_ACTIONS_CONTRACT = ROOT / "system" / "contracts" / "identity-actions.mjs"
COMPOSITION = ROOT / "system" / "composition" / "web"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
WEB_PREFERENCE_ADAPTER = ROOT / "system" / "adapters" / "web" / "preferences.mjs"
WEB_IDENTITY_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity.mjs"
WEB_IDENTITY_ACTIONS_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity-actions.mjs"
HOST_CONTRACT = ROOT / "system" / "contracts" / "surface-host.mjs"
WEB_WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class SurfaceUiContractTests(unittest.TestCase):
    def test_visual_surface_app_preference_and_store_sources_exist(self):
        for path in (
            SURFACE / "surface.mjs",
            SURFACE / "surface-state.mjs",
            SURFACE / "tokens.css",
            SURFACE / "surface.css",
            APP_CATALOG,
            APP_CONTRACT,
            *APP_OWNERS.values(),
            APPEARANCE,
            PREFERENCE_CATALOG,
            PREFERENCE_STORE_CONTRACT,
            IDENTITY_SESSION_CONTRACT,
            IDENTITY_ACTIONS_CONTRACT,
            COMPOSITION / "index.html",
            COMPOSITION / "main.mjs",
            WEB_ADAPTER,
            WEB_PREFERENCE_ADAPTER,
            WEB_IDENTITY_ADAPTER,
            WEB_IDENTITY_ACTIONS_ADAPTER,
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
        self.assertIn("contracts/preference-store.mjs", surface)
        self.assertIn("contracts/identity-session.mjs", surface)
        self.assertIn("contracts/identity-actions.mjs", surface)
        self.assertIn("../../apps/catalog.mjs", surface)
        self.assertIn("../../services/preferences/appearance.mjs", surface)

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

    def test_app_contract_is_capability_preference_session_and_action_driven(self):
        text = APP_CONTRACT.read_text(encoding="utf-8")
        self.assertIn("requiredCapabilities", text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("every((capabilityId)", text)
        self.assertIn('"preference-choice"', text)
        self.assertIn('"identity-session"', text)
        self.assertIn('"identity-actions"', text)
        self.assertIn("preferenceId", text)
        self.assertIn("PANEL_KINDS", text)

    def test_settings_uses_shared_appearance_preference(self):
        settings = APP_OWNERS["settings"].read_text(encoding="utf-8")
        appearance = APPEARANCE.read_text(encoding="utf-8")
        preferences = PREFERENCE_CATALOG.read_text(encoding="utf-8")
        self.assertIn("../../services/preferences/appearance.mjs", settings)
        self.assertIn('kind: "preference-choice"', settings)
        self.assertIn('"appearance.theme"', appearance)
        self.assertIn('defaultValue: "dark"', appearance)
        self.assertIn('value: "light"', appearance)
        self.assertIn("createPreferenceSnapshot", preferences)
        self.assertIn("recoverPreferenceSnapshot", preferences)
        self.assertIn("setPreferenceValue", preferences)

    def test_account_uses_neutral_identity_session_and_action_ports(self):
        account = APP_OWNERS["account"].read_text(encoding="utf-8")
        session_contract = IDENTITY_SESSION_CONTRACT.read_text(encoding="utf-8")
        actions_contract = IDENTITY_ACTIONS_CONTRACT.read_text(encoding="utf-8")
        session_adapter = WEB_IDENTITY_ADAPTER.read_text(encoding="utf-8")
        actions_adapter = WEB_IDENTITY_ACTIONS_ADAPTER.read_text(encoding="utf-8")
        self.assertIn('kind: "identity-session"', account)
        self.assertIn('kind: "identity-actions"', account)
        self.assertIn("ordax.identity-session/1", session_contract)
        self.assertIn("ordax.identity-actions/1", actions_contract)
        self.assertIn('state: "unavailable"', session_adapter)
        self.assertIn("supportedActions: []", actions_adapter)
        self.assertNotIn("surface/ui", session_adapter)
        self.assertNotIn("surface/ui", actions_adapter)

    def test_shared_preference_path_has_no_platform_storage_shortcut(self):
        paths = [
            APPEARANCE,
            PREFERENCE_CATALOG,
            APP_OWNERS["settings"],
            SURFACE / "surface-state.mjs",
            SURFACE / "surface.mjs",
            PREFERENCE_STORE_CONTRACT,
        ]
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for forbidden in (
                "localStorage",
                "sessionStorage",
                "navigator.",
                "adapters/web",
                "adapters/mobile",
                "adapters/desktop",
                "adapters/native",
            ):
                self.assertNotIn(forbidden, text, path)

    def test_web_preference_adapter_owns_browser_storage(self):
        adapter = WEB_PREFERENCE_ADAPTER.read_text(encoding="utf-8")
        contract = PREFERENCE_STORE_CONTRACT.read_text(encoding="utf-8")
        composition = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn("localStorage", adapter)
        self.assertIn("contracts/preference-store.mjs", adapter)
        self.assertIn('"ordax.preferences.v1"', adapter)
        self.assertIn("ordax.preference-store/1", contract)
        self.assertIn("createWebPreferenceStore", composition)
        self.assertIn("identityActions", composition)
        self.assertIn("assertPreferenceStore", surface)
        self.assertIn("store.save(state.preferences)", surface)

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

    def test_workspace_state_has_window_and_preference_lifecycle(self):
        text = (SURFACE / "surface-state.mjs").read_text(encoding="utf-8")
        for action in (
            'case "app.launch"',
            'case "window.focus"',
            'case "window.minimize"',
            'case "window.maximize"',
            'case "window.close"',
            'case "workspace.show-desktop"',
            'case "preference.set"',
        ):
            self.assertIn(action, text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("recoverPreferenceSnapshot", text)
        self.assertIn("setPreferenceValue", text)
        self.assertNotIn("platform", text.lower())
        self.assertNotIn("navigator.", text)

    def test_web_composition_is_wiring_not_visual_fork(self):
        main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn("../../surface/ui/surface.mjs", main)
        self.assertIn("../../adapters/web/runtime.mjs", main)
        self.assertIn("../../adapters/web/preferences.mjs", main)
        self.assertIn("../../adapters/web/identity.mjs", main)
        self.assertIn("../../adapters/web/identity-actions.mjs", main)
        self.assertIn("createWebIdentitySession", main)
        self.assertIn("createWebIdentityActions", main)
        self.assertIn("validateAccountRuntime", main)
        self.assertIn("../../surface/ui/tokens.css", html)
        self.assertIn("../../surface/ui/surface.css", html)
        self.assertNotIn("<style", html.lower())

    def test_visual_surface_has_no_remote_asset_or_runtime_dependency(self):
        for path in list(SURFACE.rglob("*")) + list(APPS.rglob("*")) + list(COMPOSITION.rglob("*")) + list(PREFERENCES.rglob("*")):
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

    def test_surface_baseline_is_accessible_responsive_windowed_themeable_and_account_aware(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn('aria-live="polite"', surface)
        self.assertIn('aria-label="Controles da Surface"', surface)
        self.assertIn('role="menu"', surface)
        self.assertIn("data-window-layer", surface)
        self.assertIn('event.key === "Escape"', surface)
        self.assertIn("root.dataset.ordaxTheme", surface)
        self.assertIn("data-preference-id", surface)
        self.assertIn("data.identityAction", surface)
        self.assertIn("IDENTITY_LABELS", surface)
        self.assertIn("IDENTITY_ACTION_LABELS", surface)
        self.assertIn('[data-ordax-theme="dark"]', tokens)
        self.assertIn('[data-ordax-theme="light"]', tokens)
        self.assertIn("color-scheme: light", tokens)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('.ordax-window[data-maximized="true"]', css)
        self.assertIn('.ordax-preference-choice[data-selected="true"]', css)

    def test_web_candidate_rebuilds_when_shared_product_sources_change(self):
        workflow = WEB_WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("'system/apps/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/account/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/preferences/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/preference-store.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_surface_preferences.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_account_runtime.mjs'"), 2)


if __name__ == "__main__":
    unittest.main()
