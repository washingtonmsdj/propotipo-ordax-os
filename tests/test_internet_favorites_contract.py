from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "internet-browser-controls.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
CONTRACT = ROOT / "system" / "contracts" / "browser-favorites.mjs"
STORE = ROOT / "system" / "contracts" / "browser-favorites-store.mjs"
RUNTIME = ROOT / "system" / "services" / "internet" / "favorites.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "browser-favorites.mjs"


class InternetFavoritesContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_shared_ui_uses_neutral_favorites_port(self):
        controls = self.text(CONTROLS)
        self.assertIn('contracts/browser-favorites.mjs', controls)
        self.assertIn('assertBrowserFavoritesPort', controls)
        self.assertIn('favorites = null', controls)
        self.assertIn('favoritePort.save({', controls)
        self.assertIn('favoritePort.remove(', controls)
        self.assertIn('dataset.browserFavoritesToggle', controls)
        self.assertIn('dataset.browserOpenFavorite', controls)
        self.assertIn('iconButton(documentObject, "☆", "Adicionar aos favoritos", "bookmark")', controls)
        self.assertNotIn('localStorage', controls)
        self.assertNotIn('sessionStorage', controls)
        self.assertNotIn('/__ordax/native/', controls)

    def test_native_composition_owns_device_store_and_runtime(self):
        native = self.text(NATIVE_MAIN)
        self.assertIn('createNativeBrowserFavoritesStore', native)
        self.assertIn('createBrowserFavoritesRuntime', native)
        self.assertIn('favorites: browserFavorites', native)
        self.assertIn('browserFavorites.destroy()', native)

    def test_web_composition_does_not_fake_browser_favorites(self):
        web = self.text(WEB_MAIN)
        self.assertNotIn('createNativeBrowserFavoritesStore', web)
        self.assertNotIn('createBrowserFavoritesRuntime', web)
        self.assertIn('mountInternetBrowserControls(root, browserSession, surface)', web)

    def test_favorites_have_bounded_independent_contract_and_store(self):
        contract = self.text(CONTRACT)
        store = self.text(STORE)
        runtime = self.text(RUNTIME)
        adapter = self.text(ADAPTER)
        self.assertIn('BROWSER_FAVORITES_SCHEMA = "ordax.browser-favorites/1"', contract)
        self.assertIn('MAX_BROWSER_FAVORITES = 256', contract)
        self.assertIn('BROWSER_FAVORITES_STORE_SCHEMA', store)
        self.assertIn('validateBrowserFavoriteUrl', runtime)
        self.assertIn('ordax.native.browser-favorites.v1', adapter)
        self.assertNotIn('projectId', contract)
        self.assertNotIn('projectId', runtime)


if __name__ == "__main__":
    unittest.main()
