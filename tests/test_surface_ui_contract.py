from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
COMPOSITION = ROOT / "system" / "composition" / "web"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
HOST_CONTRACT = ROOT / "system" / "contracts" / "surface-host.mjs"


class SurfaceUiContractTests(unittest.TestCase):
    def test_first_visual_surface_sources_exist(self):
        for path in (
            SURFACE / "surface.mjs",
            SURFACE / "surface-state.mjs",
            SURFACE / "tokens.css",
            SURFACE / "surface.css",
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
        self.assertIn("contracts/surface-host.mjs", (SURFACE / "surface.mjs").read_text(encoding="utf-8"))

    def test_web_composition_is_wiring_not_visual_fork(self):
        main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn("../../surface/ui/surface.mjs", main)
        self.assertIn("../../adapters/web/runtime.mjs", main)
        self.assertIn("../../surface/ui/tokens.css", html)
        self.assertIn("../../surface/ui/surface.css", html)
        self.assertNotIn("<style", html.lower())

    def test_visual_surface_has_no_remote_asset_or_runtime_dependency(self):
        for path in list(SURFACE.rglob("*")) + list(COMPOSITION.rglob("*")):
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

    def test_surface_baseline_is_accessible_and_responsive(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        self.assertIn('aria-live="polite"', surface)
        self.assertIn('aria-label="Controles da Surface"', surface)
        self.assertIn('event.key === "Escape"', surface)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("prefers-reduced-motion", css)


if __name__ == "__main__":
    unittest.main()
