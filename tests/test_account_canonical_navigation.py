from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = ROOT / "system" / "surface" / "ui" / "account-overview-controls.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "account.css"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"


class AccountCanonicalNavigationTests(unittest.TestCase):
    def test_account_exposes_only_real_current_sections(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn('id: "overview"', controls)
        self.assertIn('id: "sync"', controls)
        self.assertIn("validAccountSection", controls)
        self.assertIn('activeSection === "overview"', controls)
        self.assertIn('activeSection === "sync"', controls)
        for unavailable in ("profile", "security", "sessions", "plan"):
            self.assertNotIn(f'id: "{unavailable}"', controls)
        self.assertNotIn("sectionId", controls)
        self.assertNotIn("detailId", controls)

    def test_app_activation_is_bounded_to_account_owned_targets(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn('activation.appId === "account"', controls)
        self.assertIn("validAccountSection(activation.target)", controls)
        self.assertIn("unsubscribeActivation?.()", controls)

    def test_sync_copy_does_not_claim_cloud_transport_from_capability_only(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertNotIn('"Sincronização segura"', controls)
        self.assertNotIn('"Ativa"', controls)
        self.assertNotIn("SYNC_CORE_STATUS", controls)
        self.assertIn("Nada é chamado de sincronizado sem confirmação de um transporte autenticado.", controls)
        self.assertIn("A fila local está vazia; isso não prova que exista uma conta ou nuvem sincronizada.", controls)
        self.assertIn("nada foi anunciado como enviado à nuvem", controls)

    def test_account_no_longer_consumes_host_capability_inventory(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertNotIn("contracts/surface-host.mjs", controls)
        self.assertNotIn("assertSurfaceHost", controls)
        self.assertNotIn("hostSnapshot", controls)
        self.assertNotIn('"Identidade do host"', controls)
        self.assertNotIn('"Protocolo de sync"', controls)
        self.assertNotIn('"Segredos de dispositivo"', controls)

    def test_navigation_is_responsive_and_privacy_debug_list_was_removed(self):
        css = CSS.read_text(encoding="utf-8")
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn(".ordax-account-navigation {", css)
        self.assertIn(".ordax-account-navigation-item", css)
        self.assertIn("overflow-x: auto", css)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertNotIn("ordax-account-facts", css)
        self.assertNotIn("renderPrivacy", controls)

    def test_both_compositions_wire_same_account_activation_channel(self):
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        expected = (
            "root,\n"
            "    identitySession,\n"
            "    identityActions,\n"
            "    surface,\n"
            "    preferenceSync,\n"
            "    workspaceMetadata.source,\n"
            "    appActivation,"
        )
        self.assertIn(expected, native)
        expected_web = expected.replace("    ", "  ")
        self.assertIn(expected_web, web)
        self.assertNotIn(
            "root,\n    host,\n    identitySession,",
            native,
        )
        self.assertNotIn(
            "root,\n  host,\n  identitySession,",
            web,
        )


if __name__ == "__main__":
    unittest.main()
