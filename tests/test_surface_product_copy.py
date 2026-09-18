from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"
SETTINGS_APP = ROOT / "system" / "apps" / "settings" / "app.mjs"


class SurfaceProductCopyTests(unittest.TestCase):
    def test_home_does_not_expose_temporary_recovery_or_delivery_markers(self):
        shell = SHELL.read_text(encoding="utf-8")
        surface = SURFACE.read_text(encoding="utf-8")
        for text in (shell, surface):
            self.assertNotIn("recuperação ao vivo", text)
            self.assertNotIn("entrega 68", text)
        self.assertIn(">Área 01</p>", shell)
        self.assertIn("areaKicker.textContent = areaLabel(activeArea);", surface)
        self.assertNotIn("Surface compartilhada", shell)
        self.assertNotIn("Surface compartilhada", surface)

    def test_settings_visible_identity_is_ajustes_while_id_stays_stable(self):
        settings = SETTINGS_APP.read_text(encoding="utf-8")
        self.assertIn('id: "settings"', settings)
        self.assertIn('title: "Ajustes"', settings)
        self.assertIn('label: "Ajustes"', settings)
        self.assertIn('monogram: "AJ"', settings)
        self.assertNotIn('title: "Configurações"', settings)
        self.assertNotIn('label: "Configurações"', settings)
        self.assertNotIn('monogram: "CF"', settings)


if __name__ == "__main__":
    unittest.main()
