from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
UPDATE = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "system.css"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"


class SystemCanonicalNavigationTests(unittest.TestCase):
    def test_system_owns_validated_internal_sections_without_second_router(self):
        system = SYSTEM.read_text(encoding="utf-8")
        for section_id in ("overview", "updates", "storage", "diagnostics", "about"):
            self.assertIn(f'id: "{section_id}"', system)
        self.assertIn("validSystemSection", system)
        self.assertIn("data.systemSection", system.replace("dataset", "data"))
        self.assertIn('aria-current', system)
        self.assertIn('activation.appId === "system"', system)
        self.assertIn("validSystemSection(activation.target)", system)
        self.assertNotIn("sectionId", system)
        self.assertNotIn("detailId", system)

    def test_update_footer_is_only_an_accelerator_to_canonical_system_updates(self):
        update = UPDATE.read_text(encoding="utf-8")
        self.assertIn('activationPort.publish({ appId: "system", target: "updates" })', update)
        self.assertIn("Abrir Sistema, Atualizações", update)
        self.assertNotIn("data.updateMenu", update.replace("dataset", "data"))
        self.assertNotIn("ordax-update-menu", update)
        self.assertNotIn("targetSha", update)
        self.assertNotIn("lastError", update)
        self.assertNotIn("lastAppliedAt", update)

    def test_surface_activation_channel_opens_target_app_before_owner_handles_target(self):
        surface = SURFACE.read_text(encoding="utf-8")
        self.assertIn("activationPort?.subscribe", surface)
        self.assertIn('dispatch({ type: "app.launch", appId: activation.appId })', surface)
        self.assertIn("unsubscribeActivation?.()", surface)
        self.assertIn("activationPort.publish({ appId, target })", surface)

    def test_update_presentation_has_one_shared_owner(self):
        update = UPDATE.read_text(encoding="utf-8")
        system = SYSTEM.read_text(encoding="utf-8")
        presentation = PRESENTATION.read_text(encoding="utf-8")
        self.assertIn("services/update/presentation.mjs", update)
        self.assertIn("services/update/presentation.mjs", system)
        self.assertIn("updateIsAlerting", presentation)
        self.assertIn("updateStatusLabel", presentation)
        self.assertIn("readableUpdatePhase", presentation)
        self.assertIn("readableUpdateMode", presentation)
        self.assertIn("America/Bahia", presentation)

    def test_transaction_details_remain_in_system_updates(self):
        system = SYSTEM.read_text(encoding="utf-8")
        for marker in (
            "targetSha",
            "attemptId",
            "lastError",
            "lastAppliedAt",
            "rejectedSha",
            "runtimeSurfaceSha",
            '"Tentativa"',
            '"Diagnóstico"',
        ):
            self.assertIn(marker, system)

    def test_system_sections_expose_only_real_existing_data_owners(self):
        system = SYSTEM.read_text(encoding="utf-8")
        self.assertIn('activeSection === "overview"', system)
        self.assertIn('activeSection === "updates"', system)
        self.assertIn('activeSection === "storage"', system)
        self.assertIn('activeSection === "diagnostics"', system)
        self.assertIn('activeSection === "about"', system)
        self.assertNotIn('id: "recovery"', system)
        self.assertNotIn('id: "energy"', system)
        self.assertIn("Este host não informa uma identidade técnica de entrega", system)
        self.assertIn("Não representa o disco físico inteiro", system)

    def test_navigation_is_shared_responsive_and_wired_in_both_compositions(self):
        css = CSS.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        self.assertIn(".ordax-system-navigation {", css)
        self.assertIn(".ordax-system-navigation-item", css)
        self.assertIn('overflow-x: auto', css)
        self.assertIn("mountUpdateControls(root, updateWatcher, appActivation)", native)
        self.assertIn("updateHistory,\n    appActivation,", native)
        self.assertIn("surface,\n  null,\n  appActivation,", web)


if __name__ == "__main__":
    unittest.main()
