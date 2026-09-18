from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
SETTINGS_CSS = ROOT / "system" / "surface" / "ui" / "settings.css"
QUICK_NETWORK = ROOT / "system" / "surface" / "ui" / "network-quick-panel.mjs"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"
APP = ROOT / "system" / "apps" / "settings" / "app.mjs"


class SettingsCanonicalNavigationTests(unittest.TestCase):
    def test_settings_owns_only_real_canonical_sections(self):
        controls = SETTINGS.read_text(encoding="utf-8")
        self.assertIn('id: "appearance"', controls)
        self.assertIn('id: "accessibility"', controls)
        self.assertIn('id: "network"', controls)
        self.assertIn("validSettingsSection", controls)
        self.assertIn(
            'activeSection === "appearance" || activeSection === "accessibility"',
            controls,
        )
        self.assertIn('activeSection === "network"', controls)
        self.assertIn("definition.sectionId !== sectionId", controls)
        self.assertNotIn('id: "audio"', controls)
        self.assertNotIn('id: "display"', controls)
        self.assertNotIn("detailId", controls)

    def test_app_activation_deep_link_is_bounded_to_settings_sections(self):
        controls = SETTINGS.read_text(encoding="utf-8")
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn('activation.appId === "settings"', controls)
        self.assertIn("validSettingsSection(activation.target)", controls)
        self.assertIn("unsubscribeActivation?.()", controls)
        self.assertIn('lifecycle.getAppTarget("settings")', controls)
        self.assertIn('activationPort.publish({ appId: "settings", target: nextSection })', controls)

    def test_quick_wifi_opens_canonical_network_section(self):
        quick = QUICK_NETWORK.read_text(encoding="utf-8")
        self.assertIn('settings.dataset.launchApp = "settings"', quick)
        self.assertIn('settings.dataset.appTarget = "network"', quick)
        self.assertIn('"Abrir Ajustes de rede"', quick)

    def test_technical_capability_inventory_is_not_duplicated_in_settings(self):
        controls = SETTINGS.read_text(encoding="utf-8")
        css = SETTINGS_CSS.read_text(encoding="utf-8")
        self.assertNotIn("CAPABILITY_LABELS", controls)
        self.assertNotIn("Capacidades disponíveis", controls)
        self.assertNotIn("ordax-settings-capability", controls)
        self.assertNotIn("ordax-settings-capability", css)
        self.assertNotIn("ordax-settings-continuity", controls)
        self.assertNotIn("ordax-settings-continuity", css)

    def test_navigation_is_shared_and_responsive(self):
        css = SETTINGS_CSS.read_text(encoding="utf-8")
        self.assertIn(".ordax-settings-navigation {", css)
        self.assertIn(".ordax-settings-navigation-item", css)
        self.assertIn("overflow-x: auto", css)
        self.assertIn("@media (max-width: 760px)", css)

    def test_native_and_web_wire_same_activation_channel(self):
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        self.assertIn(
            "networkStatus,\n      networkManagement,\n      appActivation,",
            native,
        )
        self.assertIn(
            "networkStatus,\n      null,\n      appActivation,",
            native,
        )
        self.assertIn(
            "surface,\n  null,\n  null,\n  appActivation,",
            web,
        )

    def test_visible_product_name_remains_ajustes(self):
        app = APP.read_text(encoding="utf-8")
        controls = SETTINGS.read_text(encoding="utf-8")
        self.assertIn('title: "Ajustes"', app)
        self.assertIn('label: "Ajustes"', app)
        self.assertIn('monogram: "AJ"', app)
        self.assertIn('"Ajustes"', controls)
        self.assertNotIn('title: "Configurações"', app)


if __name__ == "__main__":
    unittest.main()
