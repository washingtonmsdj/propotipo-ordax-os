import ast
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system" / "apps" / "internet" / "app.mjs"
CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
CONTRACT = ROOT / "system" / "contracts" / "browser-session.mjs"
CONTROLS = ROOT / "system" / "components" / "internet" / "ui" / "browser-controls.mjs"
STYLES = ROOT / "system" / "components" / "internet" / "internet.css"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "browser-session.mjs"
NATIVE_ADAPTER = ROOT / "system" / "adapters" / "native" / "browser-session.mjs"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"
INTERNET_RUNTIME = ROOT / "system" / "components" / "internet" / "runtime.mjs"
APP_COMPONENTS = ROOT / "system" / "services" / "components" / "manifests" / "apps.mjs"


class InternetBrowserContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def browser_uri_policy(self):
        source = self.text(NATIVE_HOST)
        tree = ast.parse(source)
        names = {
            "MAX_URI_LENGTH",
            "TOP_LEVEL_NETWORK_SCHEMES",
            "RESOURCE_NETWORK_SCHEMES",
            "INTERNAL_RESOURCE_SCHEMES",
            "LOCAL_HOST_SUFFIXES",
        }
        functions = {
            "public_network_uri",
            "allowed_external_uri",
            "allowed_external_resource_uri",
        }
        selected = []
        for node in tree.body:
            if isinstance(node, ast.Import) and any(
                alias.name in {"ipaddress", "socket"} for alias in node.names
            ):
                selected.append(node)
            elif isinstance(node, ast.ImportFrom) and node.module == "urllib.parse":
                selected.append(node)
            elif isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in names for target in node.targets
            ):
                selected.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in functions:
                selected.append(node)
        namespace = {}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(NATIVE_HOST), "exec"), namespace)
        return namespace

    def test_browser_sources_exist(self):
        for path in (
            APP,
            CONTRACT,
            CONTROLS,
            STYLES,
            WEB_ADAPTER,
            NATIVE_ADAPTER,
            NATIVE_HOST,
        ):
            self.assertTrue(path.is_file(), path)
            self.assertGreater(path.stat().st_size, 0, path)

    def test_internet_is_a_first_party_extension_app(self):
        app = self.text(APP)
        catalog = self.text(CATALOG)
        self.assertIn('id: "internet"', app)
        self.assertIn('title: "Internet"', app)
        self.assertIn('kind: "extension"', app)
        self.assertIn('extensionId: "internet-browser"', app)
        self.assertIn('optionalCapabilities: ["browser.web-content"]', app)
        self.assertIn('./internet/app.mjs', catalog)
        self.assertIn('internetApp', catalog)

    def test_shared_chrome_does_not_embed_arbitrary_sites(self):
        controls = self.text(CONTROLS)
        self.assertIn('contracts/browser-session.mjs', controls)
        self.assertIn('./surface-lifecycle.mjs', controls)
        self.assertIn('assertBrowserSessionPort', controls)
        self.assertIn('data-browser-viewport', controls)
        self.assertNotIn('<iframe', controls.lower())
        self.assertNotIn('document.createElement("iframe")', controls)
        self.assertNotIn('adapters/', controls)
        self.assertNotIn('/__ordax/native/', controls)
        self.assertNotIn('MutationObserver', controls)

    def test_surface_app_activation_target_is_consumed_by_internet(self):
        controls = self.text(CONTROLS)
        self.assertIn('lifecycle.getAppTarget("internet")', controls)
        self.assertIn('const syncSurfaceTarget = () => {', controls)
        self.assertIn('handledSurfaceTarget', controls)
        self.assertIn('port.navigate(tab.id, url)', controls)
        self.assertIn('port.openTab(allocateTabId(), url)', controls)

    def test_tab_search_is_functional_and_stays_inside_shared_chrome(self):
        controls = self.text(CONTROLS)
        styles = self.text(STYLES)
        self.assertIn('searchInput.type = "search"', controls)
        self.assertIn('searchInput.dataset.browserTabSearch = ""', controls)
        self.assertIn('function tabMatchesQuery(tab, query)', controls)
        self.assertIn('toLocaleLowerCase("pt-BR")', controls)
        self.assertIn('snapshot.tabs.filter((tab) => tabMatchesQuery(tab, query))', controls)
        self.assertIn('Nenhuma aba encontrada.', controls)
        self.assertIn('root.addEventListener("input", onInput)', controls)
        self.assertIn('root.removeEventListener("input", onInput)', controls)
        self.assertIn('.ordax-internet-tab-search-input', styles)

    def test_home_reports_live_product_state_instead_of_stale_placeholders(self):
        controls = self.text(CONTROLS)
        styles = self.text(STYLES)
        for key in ("session", "projects", "references", "favorites"):
            self.assertIn(f'["{key}",', controls)
        self.assertIn('value.dataset.browserHomeStatus = key', controls)
        self.assertIn('const syncHomeStatus = (slot) => {', controls)
        self.assertIn('projectSnapshot?.projects.length', controls)
        self.assertIn('referenceSnapshot?.references.length', controls)
        self.assertIn('favoriteSnapshot?.favorites.length', controls)
        self.assertIn('syncHomeStatus(slot)', controls)
        self.assertNotIn('"REFERÊNCIAS", "Persistência em preparação"', controls)
        self.assertIn('repeat(auto-fit, minmax(140px, 1fr))', styles)

    def test_web_mode_fails_closed_instead_of_claiming_embedded_navigation(self):
        adapter = self.text(WEB_ADAPTER)
        self.assertIn('createUnavailableBrowserSession', adapter)
        self.assertIn('não incorpora sites arbitrários', adapter)
        self.assertNotIn('iframe', adapter.lower())

    def test_native_adapter_uses_one_explicit_browser_bridge(self):
        adapter = self.text(NATIVE_ADAPTER)
        self.assertIn('HANDLER_NAME = "ordaxBrowser"', adapter)
        self.assertIn('windowRef?.webkit?.messageHandlers', adapter)
        self.assertIn('ordax-browser-host', adapter)
        for command in (
            'tab.open',
            'tab.close',
            'tab.activate',
            'tab.navigate',
            'tab.back',
            'tab.forward',
            'tab.reload',
            'viewport.set',
        ):
            self.assertIn(command, adapter)

    def test_native_host_separates_privileged_surface_from_external_webviews(self):
        host = self.text(NATIVE_HOST)
        self.assertIn('UserContentManager.new()', host)
        self.assertIn('WebView.new_with_user_content_manager(self.manager)', host)
        self.assertIn('WebsiteDataManager(', host)
        self.assertIn('WebContext.new_with_website_data_manager', host)
        self.assertIn('WebView.new_with_context(self.external_context)', host)
        self.assertIn('host == "localhost"', host)
        self.assertIn('TOP_LEVEL_NETWORK_SCHEMES = frozenset({"http", "https"})', host)
        self.assertIn('socket.inet_aton(host)', host)
        self.assertIn('return address.is_global', host)
        self.assertIn('resource-load-started', host)
        self.assertIn('resource.connect("send-request"', host)
        self.assertIn('request.set_uri("about:blank")', host)
        self.assertIn('request.deny()', host)
        self.assertIn('download.cancel()', host)
        self.assertNotIn('new_with_user_content_manager(self.manager)', host.split('def create_external_view', 1)[1])
        ast.parse(host)

    def test_external_uri_policy_rejects_local_and_non_public_targets(self):
        policy = self.browser_uri_policy()
        allowed_navigation = policy["allowed_external_uri"]
        allowed_resource = policy["allowed_external_resource_uri"]

        self.assertTrue(allowed_navigation("https://example.com/path"))
        self.assertTrue(allowed_navigation("https://8.8.8.8/"))
        self.assertTrue(allowed_resource("wss://example.com/socket"))
        self.assertTrue(allowed_resource("data:text/plain,ok"))
        self.assertTrue(allowed_resource("about:blank"))

        rejected = (
            "http://localhost/",
            "http://service.local/",
            "http://router.home.arpa/",
            "http://printer/",
            "http://127.0.0.1/",
            "http://0.0.0.0/",
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://[::1]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://0177.0.0.1/",
            "http://127.1/",
            "http://0x7f.0.0.1/",
            "http://2130706433/",
            "http://0300.0250.0001.0001/",
            "http://0xc0.0xa8.0x1.0x1/",
        )
        for uri in rejected:
            with self.subTest(uri=uri):
                self.assertFalse(allowed_navigation(uri))
                self.assertFalse(allowed_resource(uri))

    def test_native_surface_runtime_owns_webkit_dependencies_directly(self):
        launcher = self.text(SURFACE_LAUNCHER)
        self.assertIn('RUNTIME_ID=alpine-v3.22-cage-webkitgtk-v1', launcher)
        self.assertIn('python3 py3-gobject3 gtk+3.0 webkit2gtk-4.1', launcher)
        self.assertIn('/srv/ordax-system/surface/runtime/ordax_browser_host.py', launcher)
        self.assertIn('--profile-root /var/lib/ordax-user/browser', launcher)
        self.assertNotIn('barkery-browser', launcher)
        self.assertNotIn('/usr/bin/barkery', launcher)
        subprocess.run(["sh", "-n", str(SURFACE_LAUNCHER)], check=True)

    def test_browser_capability_is_native_and_isolated(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        browser = capabilities["browser.web-content"]
        self.assertEqual(browser["owner"], "system/adapters")
        self.assertEqual(browser["security_boundary"], "isolated-unprivileged-web-content")
        modes = {mode["id"]: mode for mode in contract["modes"]}
        for mode_id in ("usb", "native-disk"):
            self.assertIn("browser.web-content", modes[mode_id]["baseline_capabilities"])
        for mode_id in ("web", "mobile", "desktop"):
            self.assertNotIn("browser.web-content", modes[mode_id]["baseline_capabilities"])

    def test_native_surface_health_is_acknowledged_before_optional_internet_load(self):
        native = self.text(NATIVE_COMPOSITION / "main.mjs")
        health_index = native.index("void updateWatcher.markHealthy()")
        import_index = native.index('import("../../components/internet/runtime.mjs")')
        self.assertLess(health_index, import_index)
        self.assertIn('componentManager.setCurrentHealth("surface-shell", "healthy")', native)
        self.assertIn('componentId: "internet"', native)
        self.assertIn('reportClientDiagnostic("internet-runtime", error)', native)
        self.assertNotIn('from "../../services/internet/', native)
        self.assertNotIn('from "../../surface/ui/internet-browser-', native)

    def test_both_compositions_load_internet_as_optional_component_runtime(self):
        runtime = self.text(INTERNET_RUNTIME)
        manifests = self.text(APP_COMPONENTS)
        self.assertIn('componentId: "internet"', runtime)
        self.assertIn('version: "0.4.0"', runtime)
        self.assertIn('version: "0.4.0"', manifests)
        self.assertIn('restartScope: "component"', manifests)
        self.assertIn('healthMode: "runtime"', manifests)
        self.assertIn('mountInternetBrowserControls', runtime)
        self.assertIn('new URL("./internet.css", import.meta.url)', runtime)
        self.assertIn('mountInternetStyles', runtime)
        self.assertIn('releaseStyles()', runtime)
        for composition in (WEB_COMPOSITION, NATIVE_COMPOSITION):
            html = self.text(composition / "index.html")
            main = self.text(composition / "main.mjs")
            self.assertNotIn('../../surface/ui/internet.css', html)
            self.assertIn('import("../../components/internet/runtime.mjs")', main)
            self.assertIn('loadOptionalComponentRuntime', main)
            self.assertIn('browserSession', main)
            self.assertNotIn('from "../../surface/ui/internet-browser-controls.mjs"', main)


if __name__ == "__main__":
    unittest.main()
