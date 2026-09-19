from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "docs" / "contracts" / "branding.json"
COVERAGE = ROOT / "docs" / "contracts" / "device-update-coverage.json"
BOOT_SCREEN = ROOT / "system" / "surface" / "ui" / "boot-screen.mjs"
BOOT_CSS = ROOT / "system" / "surface" / "ui" / "boot-screen.css"
WEB_HTML = ROOT / "system" / "composition" / "web" / "index.html"
NATIVE_HTML = ROOT / "system" / "composition" / "native" / "index.html"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
KERNEL = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"


class SurfaceBootScreenTests(unittest.TestCase):
    def test_branding_contract_distinguishes_surface_loading_from_early_splash(self):
        branding = json.loads(BRANDING.read_text(encoding="utf-8"))
        coverage = json.loads(COVERAGE.read_text(encoding="utf-8"))

        self.assertEqual(branding["$schema"], "prototype-ordax.branding/1")
        self.assertTrue(branding["surface_loading"]["implemented"])
        self.assertEqual(
            branding["surface_loading"]["delivery"],
            "runtime-git-checkout",
        )
        self.assertFalse(
            branding["surface_loading"]["usb_rewrite_required"]
        )
        self.assertFalse(
            branding["early_boot"]["graphical_splash_implemented"]
        )
        self.assertTrue(
            branding["failure_policy"]["branding_must_not_block_boot"]
        )

        self.assertTrue(coverage["branding"]["surface_loading_implemented"])
        self.assertFalse(coverage["branding"]["graphical_boot_splash_implemented"])
        self.assertTrue(coverage["branding"]["branding_source_must_remain_repository_owned"])

    def test_both_compositions_render_loading_before_javascript_mount(self):
        for path in (WEB_HTML, NATIVE_HTML):
            html = path.read_text(encoding="utf-8")
            self.assertIn('href="../../surface/ui/boot-screen.css"', html)
            self.assertIn('id="ordax-boot-screen"', html)
            self.assertIn('data-ordax-boot-status', html)
            self.assertIn("Preparando OrdaX", html)
            self.assertLess(
                html.index('id="ordax-boot-screen"'),
                html.index('id="ordax-root"'),
            )
            self.assertLess(
                html.index('id="ordax-boot-screen"'),
                html.index('src="./main.mjs"'),
            )

    def test_loading_controller_has_ready_and_visible_failure_states(self):
        controller = BOOT_SCREEN.read_text(encoding="utf-8")
        css = BOOT_CSS.read_text(encoding="utf-8")

        self.assertIn("createSurfaceBootScreen", controller)
        self.assertIn("setStage", controller)
        self.assertIn("ready()", controller)
        self.assertIn("fail(", controller)
        self.assertIn('element.hidden = true', controller)
        self.assertIn('element.dataset.state = "error"', controller)
        self.assertIn(".ordax-boot-screen", css)
        self.assertIn(".ordax-boot-spinner", css)
        self.assertIn("prefers-reduced-motion", css)

    def test_compositions_finish_loading_only_after_optional_apps_are_attempted(self):
        for path in (WEB_MAIN, NATIVE_MAIN):
            source = path.read_text(encoding="utf-8")
            self.assertIn("createSurfaceBootScreen", source)
            self.assertIn('bootScreen.setStage("Carregando superfície…")', source)
            self.assertIn('bootScreen.setStage("Carregando aplicativos…")', source)
            self.assertIn("bootScreen.ready()", source)
            self.assertIn('bootScreen.fail("Não foi possível iniciar a interface")', source)
            self.assertLess(
                source.index('componentId: "notes"'),
                source.index("bootScreen.ready()"),
            )
            self.assertLess(
                source.index('componentId: "internet"'),
                source.index("bootScreen.ready()"),
            )

    def test_kernel_keeps_framebuffer_capability_for_future_early_graphics(self):
        config = KERNEL.read_text(encoding="utf-8")
        self.assertIn("CONFIG_FB=y", config)
        self.assertIn("CONFIG_FB_EFI=y", config)
        self.assertIn("CONFIG_DRM_SIMPLEDRM=y", config)
        self.assertIn("CONFIG_FRAMEBUFFER_CONSOLE=y", config)


if __name__ == "__main__":
    unittest.main()
