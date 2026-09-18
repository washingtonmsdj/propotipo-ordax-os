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
SYNC_RUNTIME_CONTRACT = ROOT / "system" / "contracts" / "sync-runtime.mjs"
SYNC_STATE_STORE_CONTRACT = ROOT / "system" / "contracts" / "sync-state-store.mjs"
WORKSPACE_METADATA_CONTRACT = ROOT / "system" / "contracts" / "workspace-metadata-source.mjs"
WORKSPACE_METADATA_SERVICE = ROOT / "system" / "services" / "sync" / "workspace-metadata.mjs"
WEB_SYNC_STATE_ADAPTER = ROOT / "system" / "adapters" / "web" / "sync-state.mjs"
NATIVE_SYNC_STATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "sync-state.mjs"
PREFERENCE_SYNC_SERVICE = ROOT / "system" / "services" / "sync" / "preference-runtime.mjs"
IDENTITY_SESSION_CONTRACT = ROOT / "system" / "contracts" / "identity-session.mjs"
IDENTITY_ACTIONS_CONTRACT = ROOT / "system" / "contracts" / "identity-actions.mjs"
POWER_ACTIONS_CONTRACT = ROOT / "system" / "contracts" / "power-actions.mjs"
APP_ACTIVATION_CONTRACT = ROOT / "system" / "contracts" / "app-activation.mjs"
APP_ACTIVATION_SERVICE = ROOT / "system" / "services" / "apps" / "activation.mjs"
COMPOSITION = ROOT / "system" / "composition" / "web"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
WEB_PREFERENCE_ADAPTER = ROOT / "system" / "adapters" / "web" / "preferences.mjs"
WEB_IDENTITY_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity.mjs"
WEB_IDENTITY_ACTIONS_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity-actions.mjs"
NATIVE_POWER_ADAPTER = ROOT / "system" / "adapters" / "native" / "power-actions.mjs"
NATIVE_SURFACE_HEARTBEAT_ADAPTER = ROOT / "system" / "adapters" / "native" / "surface-heartbeat.mjs"
POWER_CONTROLS = SURFACE / "power-controls.mjs"
UPDATE_CONTROLS = SURFACE / "update-controls.mjs"
DESKTOP_SHELL = SURFACE / "desktop-shell.mjs"
SURFACE_LIFECYCLE = SURFACE / "surface-lifecycle.mjs"
FILE_SPACE_CONTROLS = SURFACE / "file-space-controls.mjs"
SYSTEM_OVERVIEW_CONTROLS = SURFACE / "system-overview-controls.mjs"
ACCOUNT_OVERVIEW_CONTROLS = SURFACE / "account-overview-controls.mjs"
SETTINGS_OVERVIEW_CONTROLS = SURFACE / "settings-overview-controls.mjs"
SYSTEM_TRAY_QUICK_PANELS = SURFACE / "system-tray-quick-panels.mjs"
NETWORK_QUICK_PANEL = SURFACE / "network-quick-panel.mjs"
HOST_CONTRACT = ROOT / "system" / "contracts" / "surface-host.mjs"
WEB_WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class SurfaceUiContractTests(unittest.TestCase):
    def test_visual_surface_app_preference_and_store_sources_exist(self):
        for path in (
            SURFACE / "surface.mjs",
            SURFACE / "surface-state.mjs",
            DESKTOP_SHELL,
            SURFACE_LIFECYCLE,
            FILE_SPACE_CONTROLS,
            SYSTEM_OVERVIEW_CONTROLS,
            ACCOUNT_OVERVIEW_CONTROLS,
            SETTINGS_OVERVIEW_CONTROLS,
            SYSTEM_TRAY_QUICK_PANELS,
            NETWORK_QUICK_PANEL,
            SURFACE / "tokens.css",
            SURFACE / "surface.css",
            SURFACE / "files.css",
            SURFACE / "system.css",
            SURFACE / "account.css",
            SURFACE / "settings.css",
            POWER_CONTROLS,
            APP_CATALOG,
            APP_CONTRACT,
            *APP_OWNERS.values(),
            APPEARANCE,
            PREFERENCE_CATALOG,
            PREFERENCE_STORE_CONTRACT,
            SYNC_RUNTIME_CONTRACT,
            SYNC_STATE_STORE_CONTRACT,
            WORKSPACE_METADATA_CONTRACT,
            PREFERENCE_SYNC_SERVICE,
            WORKSPACE_METADATA_SERVICE,
            WEB_SYNC_STATE_ADAPTER,
            NATIVE_SYNC_STATE_ADAPTER,
            IDENTITY_SESSION_CONTRACT,
            IDENTITY_ACTIONS_CONTRACT,
            POWER_ACTIONS_CONTRACT,
            APP_ACTIVATION_CONTRACT,
            APP_ACTIVATION_SERVICE,
            COMPOSITION / "index.html",
            COMPOSITION / "main.mjs",
            NATIVE_COMPOSITION / "index.html",
            NATIVE_COMPOSITION / "main.mjs",
            WEB_ADAPTER,
            WEB_PREFERENCE_ADAPTER,
            WEB_IDENTITY_ADAPTER,
            WEB_IDENTITY_ACTIONS_ADAPTER,
            NATIVE_POWER_ADAPTER,
            NATIVE_SURFACE_HEARTBEAT_ADAPTER,
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
        power = POWER_CONTROLS.read_text(encoding="utf-8")
        self.assertIn("contracts/surface-host.mjs", surface)
        self.assertIn("contracts/preference-store.mjs", surface)
        self.assertIn("contracts/preference-runtime.mjs", surface)
        self.assertIn("PREFERENCE_RUNTIME_SCHEMA", surface)
        self.assertIn("preferences,", surface)
        self.assertNotIn("contracts/identity-session.mjs", surface)
        self.assertNotIn("contracts/identity-actions.mjs", surface)
        self.assertIn("contracts/app-activation.mjs", surface)
        self.assertIn("../../apps/catalog.mjs", surface)
        self.assertIn("../../services/preferences/appearance.mjs", surface)
        self.assertIn("./desktop-shell.mjs", surface)
        self.assertIn("./surface-lifecycle.mjs", surface)
        self.assertIn("SURFACE_RENDER_LIFECYCLE_SCHEMA", surface)
        self.assertIn("subscribeRender(listener)", surface)
        self.assertIn("../../contracts/power-actions.mjs", power)

    def test_surface_owns_context_menu_boundary_instead_of_browser_chrome(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn('const onContextMenu = (event) => {', surface)
        self.assertIn('event.preventDefault();', surface)
        self.assertIn('root.addEventListener("contextmenu", onContextMenu)', surface)
        self.assertIn('root.removeEventListener("contextmenu", onContextMenu)', surface)
        for browser_action in ("Back", "Forward", "Stop", "Reload"):
            self.assertNotIn(browser_action, surface)

    def test_shared_extensions_use_explicit_surface_render_lifecycle(self):
        lifecycle = SURFACE_LIFECYCLE.read_text(encoding="utf-8")
        self.assertIn('ordax.surface-render-lifecycle/1', lifecycle)
        self.assertIn("assertSurfaceRenderLifecycle", lifecycle)
        for path in (FILE_SPACE_CONTROLS, SYSTEM_OVERVIEW_CONTROLS, ACCOUNT_OVERVIEW_CONTROLS, SETTINGS_OVERVIEW_CONTROLS):
            text = path.read_text(encoding="utf-8")
            self.assertIn("./surface-lifecycle.mjs", text, path)
            self.assertIn("assertSurfaceRenderLifecycle", text, path)
            self.assertIn("subscribeRender", text, path)
            self.assertNotIn("MutationObserver", text, path)

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

    def test_app_contract_is_capability_preference_and_extension_driven(self):
        text = APP_CONTRACT.read_text(encoding="utf-8")
        self.assertIn("requiredCapabilities", text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("every((capabilityId)", text)
        self.assertIn('"preference-choice"', text)
        self.assertIn('"extension"', text)
        self.assertIn("extensionId", text)
        self.assertIn("preferenceId", text)
        self.assertIn("PANEL_KINDS", text)
        self.assertNotIn('"identity-session"', text)
        self.assertNotIn('"identity-actions"', text)

    def test_files_uses_formal_shared_extension_slot(self):
        files = APP_OWNERS["files"].read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "files.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', files)
        self.assertIn('extensionId: "file-space"', files)
        self.assertIn('panel.kind === "extension"', surface)
        self.assertIn("dataset.appExtension", surface)
        self.assertIn('.ordax-files-view', css)
        self.assertIn("../../surface/ui/files.css", web_html)
        self.assertIn("../../surface/ui/files.css", native_html)

    def test_system_uses_formal_shared_overview_extension(self):
        system = APP_OWNERS["system"].read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        css = (SURFACE / "system.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', system)
        self.assertIn('extensionId: "system-overview"', system)
        self.assertIn('SYSTEM_EXTENSION_SELECTOR', overview)
        self.assertIn("assertSurfaceHost", overview)
        self.assertIn("assertUpdateStatusPort", overview)
        self.assertIn("assertUpdateHistoryPort", overview)
        self.assertIn("assertSystemMetricsPort", overview)
        self.assertIn("Histórico de atualizações", overview)
        self.assertIn("Versão global", overview)
        self.assertIn("Incluído nesta entrega", overview)
        self.assertIn("America/Bahia", overview)
        self.assertIn(".ordax-system-view", css)
        self.assertIn("../../surface/ui/system.css", web_html)
        self.assertIn("../../surface/ui/system.css", native_html)

    def test_settings_uses_live_preference_runtime_and_shared_overview(self):
        settings = APP_OWNERS["settings"].read_text(encoding="utf-8")
        overview = SETTINGS_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        appearance = APPEARANCE.read_text(encoding="utf-8")
        preferences = PREFERENCE_CATALOG.read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "settings.css").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', settings)
        self.assertIn('extensionId: "settings-overview"', settings)
        self.assertIn("contracts/preference-runtime.mjs", overview)
        self.assertIn("contracts/network-management.mjs", overview)
        self.assertIn("assertPreferenceRuntimePort", overview)
        self.assertIn("assertNetworkManagementPort", overview)
        self.assertIn("listPreferenceDefinitions", overview)
        self.assertIn('"Ajustes"', overview)
        self.assertIn('"Procurar redes"', overview)
        self.assertIn('"Conectar"', overview)
        self.assertIn('"Desconectar"', overview)
        self.assertIn('"Esquecer"', overview)
        self.assertIn('"Reconectar"', overview)
        self.assertIn('input.type = "password"', overview)
        self.assertIn('input.value = ""', overview)
        self.assertIn('event.key === "Enter"', overview)
        self.assertIn('event.key === "Escape"', overview)
        self.assertIn('"appearance.theme"', appearance)
        self.assertIn('defaultValue: "light"', appearance)
        self.assertIn('value: "dark"', appearance)
        self.assertIn("createPreferenceSnapshot", preferences)
        self.assertIn("setPreferenceValue", preferences)
        self.assertIn("PREFERENCE_RUNTIME_SCHEMA", surface)
        self.assertIn(".ordax-settings-view", css)
        self.assertIn("surface.preferences", web_main)
        self.assertIn("surface.preferences", native_main)
        self.assertIn("networkManagement,", native_main)
        self.assertIn("createPreferenceSyncRuntime", web_main)
        self.assertIn("createPreferenceSyncRuntime", native_main)
        self.assertIn("preferenceSync", web_main)
        self.assertIn("preferenceSync", native_main)
        self.assertIn("createWebSyncStateStore", web_main)
        self.assertIn("createNativeSyncStateStore", native_main)
        self.assertIn("syncStateStore", web_main)
        self.assertIn("syncStateStore", native_main)
        self.assertIn("createWorkspaceMetadataBridge", web_main)
        self.assertIn("createWorkspaceMetadataBridge", native_main)
        self.assertIn("workspaceMetadata.store", web_main)
        self.assertIn("workspaceMetadata.store", native_main)
        self.assertIn("workspaceMetadata.source", web_main)
        self.assertIn("workspaceMetadata.source", native_main)
        self.assertNotIn("localStorage", overview)
        self.assertNotIn("/__ordax/native/preferences", overview)
        self.assertNotIn("/__ordax/native/network-management", overview)
        self.assertNotIn("localStorage", overview)

    def test_account_uses_formal_shared_overview_and_neutral_identity_ports(self):
        account = APP_OWNERS["account"].read_text(encoding="utf-8")
        overview = ACCOUNT_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        session_contract = IDENTITY_SESSION_CONTRACT.read_text(encoding="utf-8")
        actions_contract = IDENTITY_ACTIONS_CONTRACT.read_text(encoding="utf-8")
        session_adapter = WEB_IDENTITY_ADAPTER.read_text(encoding="utf-8")
        actions_adapter = WEB_IDENTITY_ACTIONS_ADAPTER.read_text(encoding="utf-8")
        css = (SURFACE / "account.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")

        self.assertIn('kind: "extension"', account)
        self.assertIn('extensionId: "account-overview"', account)
        self.assertIn("contracts/identity-session.mjs", overview)
        self.assertIn("contracts/identity-actions.mjs", overview)
        self.assertIn("contracts/surface-host.mjs", overview)
        self.assertIn("services/sync/runtime.mjs", overview)
        self.assertIn("contracts/sync-runtime.mjs", overview)
        self.assertIn("assertSyncRuntimePort", overview)
        self.assertIn("pendingMutationCount", overview)
        self.assertIn("queuePersistence", overview)
        self.assertIn("contracts/workspace-metadata-source.mjs", overview)
        self.assertIn("assertWorkspaceMetadataSource", overview)
        self.assertIn('"Áreas e apps"', overview)
        self.assertIn("posição, tamanho, maximização e minimização continuam locais", overview)
        self.assertIn("sobrevive a reload/reinício", overview)
        self.assertIn("nada foi enviado para a nuvem", overview)
        self.assertIn("ordax.identity-session/1", session_contract)
        self.assertIn("ordax.identity-actions/1", actions_contract)
        self.assertIn('state: "unavailable"', session_adapter)
        self.assertIn("supportedActions: []", actions_adapter)
        self.assertIn(".ordax-account-view", css)
        self.assertIn("../../surface/ui/account.css", web_html)
        self.assertIn("../../surface/ui/account.css", native_html)
        self.assertNotIn("adapters/native", overview)
        self.assertNotIn("adapters/web", overview)
        self.assertNotIn("surface/ui", session_adapter)
        self.assertNotIn("surface/ui", actions_adapter)

    def test_native_power_controls_are_shared_and_capability_driven(self):
        contract = POWER_ACTIONS_CONTRACT.read_text(encoding="utf-8")
        controls = POWER_CONTROLS.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        adapter = NATIVE_POWER_ADAPTER.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")

        self.assertIn("ordax.power-actions/1", contract)
        self.assertIn('"restart"', contract)
        self.assertIn('"shutdown"', contract)
        self.assertIn("assertPowerActionsPort", controls)
        self.assertIn('"Confirmar reinício"', controls)
        self.assertIn('"Confirmar desligamento"', controls)
        self.assertIn("dataset.powerAction", controls)
        self.assertIn("[data-power-slot]", controls)
        self.assertIn("data-power-slot", shell)
        self.assertIn("createNativePowerActions", native_main)
        self.assertIn("../../surface/ui/surface.mjs", native_main)
        self.assertIn("../../surface/ui/power-controls.mjs", native_main)
        self.assertIn("../../surface/ui/tokens.css", native_html)
        self.assertIn("../../surface/ui/surface.css", native_html)
        self.assertNotIn("<style", native_html.lower())
        self.assertIn("contracts/power-actions.mjs", adapter)
        self.assertIn("/__ordax/native/session", adapter)
        self.assertIn("/__ordax/native/power", adapter)
        self.assertNotIn("surface/ui", adapter)
        self.assertNotIn("innerHTML", adapter)
        self.assertNotIn("adapters/native", web_main)
        self.assertNotIn("power-actions", web_main)

    def test_native_composition_reports_rendered_surface_liveness_locally(self):
        adapter = NATIVE_SURFACE_HEARTBEAT_ADAPTER.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn('/__ordax/native/surface-heartbeat', adapter)
        self.assertIn("nativeSurfaceSourceSha", adapter)
        self.assertIn("new URL(windowRef.location.href)", adapter)
        self.assertIn("createNativeSurfaceHeartbeat", native_main)
        self.assertIn("surfaceHeartbeat.dispose()", native_main)
        self.assertNotIn("http://", adapter)
        self.assertNotIn("https://", adapter)

    def test_update_center_distinguishes_git_head_from_surface_runtime(self):
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        contract = (ROOT / "system" / "contracts" / "update-status.mjs").read_text(encoding="utf-8")
        self.assertIn("runtimeSurfaceSha", contract)
        self.assertIn("snapshot.runtimeSurfaceSha", controls)
        self.assertIn("snapshot?.versionNumber", controls)
        self.assertIn("America/Bahia", controls)
        self.assertIn("Runtime alinhado com a versão Git.", controls)
        self.assertIn("Runtime mantido no último commit com efeito na Surface.", controls)

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
        self.assertIn("../../surface/ui/files.css", html)
        self.assertIn("../../surface/ui/system.css", html)
        self.assertIn("../../surface/ui/account.css", html)
        self.assertIn("../../surface/ui/settings.css", html)
        self.assertNotIn("<style", html.lower())

    def test_visual_surface_has_no_remote_asset_or_runtime_dependency(self):
        roots = [SURFACE, APPS, COMPOSITION, NATIVE_COMPOSITION, PREFERENCES]
        for path in [item for root in roots for item in root.rglob("*")]:
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

    def test_desktop_identity_shell_is_shared_semantic_and_non_remote(self):
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        for app_id in ("files", "settings", "account", "system"):
            self.assertIn(f'railButton("{app_id}"', shell)
        self.assertIn("data-power-slot", shell)
        self.assertIn("data-update-slot", shell)
        self.assertIn("data-ordax-clock", shell)
        self.assertIn("data-ordax-tray-clock", shell)
        self.assertIn("data-battery-tray", shell)
        self.assertIn("data-battery-icon", shell)
        self.assertIn("data-battery-label", shell)
        self.assertIn("data-connectivity-icon", shell)
        self.assertIn("ordax-network-symbol-wifi", shell)
        self.assertIn("ordax-network-symbol-ethernet", shell)
        self.assertIn('data-signal-level="0"', shell)
        self.assertIn('data-quick-panel-toggle="network"', shell)
        self.assertIn('data-quick-panel-toggle="datetime"', shell)
        self.assertIn('data-quick-panel="network"', shell)
        self.assertIn('data-quick-panel="datetime"', shell)
        self.assertNotIn('data-connectivity-tray data-launch-app="settings"', shell)
        self.assertIn("ordax-system-tray", shell)
        self.assertIn('SURFACE_TIME_ZONE = "America/Bahia"', shell)
        self.assertIn('timeZone: SURFACE_TIME_ZONE', shell)
        self.assertIn("trayTimeNode.textContent = formattedTime", shell)
        self.assertIn("quickTimeNode.textContent = formattedTime", shell)
        self.assertIn("quickDateNode.textContent", shell)
        self.assertIn('const connectivityIcon = root.querySelector("[data-connectivity-icon]")', surface)
        self.assertIn("connectivityIcon.dataset.state = state.connectivity", surface)
        self.assertIn("data-launcher-query", shell)
        self.assertIn("Ctrl + K", shell)
        self.assertIn("ordax-brand-symbol", shell)
        self.assertIn("ordax-identity-art", shell)
        self.assertIn("--ordax-accent: #ed4b25", tokens)
        self.assertIn("--ordax-font-display", tokens)
        self.assertIn(".ordax-identity-art", css)
        self.assertIn(".ordax-rail", css)
        self.assertIn(".ordax-statusbar", css)
        self.assertIn(".ordax-wifi-arc-outer", css)
        self.assertIn(".ordax-battery-segment", css)
        self.assertIn(".ordax-battery-bolt", css)
        self.assertIn('[data-network-kind="ethernet"]', css)
        self.assertIn(".ordax-quick-panel-layer", css)
        self.assertIn(".ordax-quick-panel-datetime", css)

    def test_system_tray_quick_panels_are_shared_accessible_and_platform_neutral(self):
        controller = SYSTEM_TRAY_QUICK_PANELS.read_text(encoding="utf-8")
        network = NETWORK_QUICK_PANEL.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")

        self.assertIn("data-quick-panel-toggle", controller)
        self.assertIn('event.key === "Escape"', controller)
        self.assertIn("ordax:quick-panel-open", controller)
        self.assertIn("aria-expanded", controller)
        self.assertIn("assertNetworkManagementPort", network)
        self.assertIn("assertNetworkStatusPort", network)
        self.assertIn('"Procurar redes"', network)
        self.assertIn('"Conectar"', network)
        self.assertIn('"Desconectar"', network)
        self.assertIn('"Reconectar"', network)
        self.assertIn('"Abrir Ajustes de rede"', network)
        self.assertNotIn('"Esquecer"', network)
        self.assertIn('input.type = "password"', network)
        self.assertIn('input.autocomplete = "off"', network)
        self.assertIn('input.value = ""', network)
        for forbidden in ("localStorage", "sessionStorage", "/__ordax/native/", "telemetry"):
            self.assertNotIn(forbidden, network)
        self.assertIn("mountSystemTrayQuickPanels", native_main)
        self.assertIn("mountNetworkQuickPanel", native_main)
        self.assertIn("mountSystemTrayQuickPanels", web_main)
        self.assertIn("mountNetworkQuickPanel(root, null, null)", web_main)

    def test_windows_center_by_default_and_maximize_to_full_workspace(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        self.assertIn('inset: 0;\n  pointer-events: none;', css)
        self.assertIn('top: calc(50% + var(--ordax-window-offset) / 3);', css)
        self.assertIn('left: calc(50% + var(--ordax-window-offset) / 2);', css)
        self.assertIn('transform: translate(-50%, -50%);', css)
        self.assertIn('.ordax-window[data-maximized="true"] {', css)
        self.assertIn('.ordax-window[data-maximized="true"] .ordax-window-body', css)
        self.assertIn('height: calc(100% - 58px);', css)
        self.assertIn('((placementOrdinal - 1) % 5) * 18', surface)
        self.assertNotIn('inset: 8px 12px;', css)
        self.assertNotIn('transform: translateY(4px);', css)

    def test_surface_baseline_is_accessible_responsive_windowed_and_themeable(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        power = POWER_CONTROLS.read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn('aria-live="polite"', shell)
        self.assertIn('aria-label="Estado e áreas da Surface"', shell)
        self.assertIn('role="dialog"', shell)
        self.assertIn("data-window-layer", shell)
        self.assertIn('event.key === "Escape"', surface)
        self.assertIn('event.key.toLocaleLowerCase() === "k"', surface)
        self.assertIn("root.dataset.ordaxTheme", surface)
        self.assertIn("data-preference-id", surface)
        self.assertNotIn("dataset.identityAction", surface)
        self.assertNotIn("IDENTITY_LABELS", surface)
        self.assertNotIn("IDENTITY_ACTION_LABELS", surface)
        self.assertIn('role", "dialog"', power)
        self.assertIn('aria-live", "polite"', power)
        self.assertIn('[data-ordax-theme="dark"]', tokens)
        self.assertIn('[data-ordax-theme="light"]', tokens)
        self.assertIn("color-scheme: light", tokens)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('.ordax-window[data-maximized="true"]', css)
        self.assertIn('.ordax-preference-choice[data-selected="true"]', css)

    def test_web_candidate_rebuilds_when_shared_and_native_product_sources_change(self):
        workflow = WEB_WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("'system/apps/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/account/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/preferences/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/preference-store.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/preference-runtime.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/sync-runtime.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/sync-state-store.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/workspace-metadata-source.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/power-actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/app-activation.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/apps/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/adapters/native/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/composition/native/**'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_surface_preferences.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_power_actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_account_runtime.mjs'"), 2)
        self.assertIn("system/adapters/native", workflow)
        self.assertIn("system/composition/native", workflow)
        self.assertIn("node --test tests/test_power_actions.mjs", workflow)
        self.assertIn("node --test tests/test_app_activation.mjs", workflow)
        self.assertIn("node --test tests/test_app_contract.mjs", workflow)


if __name__ == "__main__":
    unittest.main()
