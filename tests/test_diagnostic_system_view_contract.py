from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / "system" / "surface" / "ui" / "system-diagnostics-review.mjs"


class SystemDiagnosticsReviewViewContractTests(unittest.TestCase):
    def source(self):
        return VIEW.read_text(encoding="utf-8")

    def test_view_consumes_shared_diagnostic_controller_without_host_coupling(self):
        source = self.source()
        self.assertIn("services/diagnostics/controller.mjs", source)
        self.assertIn("createDiagnosticReviewPresentation", source)
        self.assertIn("mountSystemDiagnosticsReview", source)
        self.assertNotIn("adapters/native", source)
        self.assertNotIn("/__ordax/native/", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("FileSystem", source)

    def test_view_uses_safe_dom_construction_and_explicit_actions(self):
        source = self.source()
        self.assertIn("createElement", source)
        self.assertIn("textContent", source)
        self.assertNotIn("innerHTML", source)
        self.assertIn("dataset.systemDiagnosticsPrepare", source)
        self.assertIn("dataset.systemDiagnosticsExport", source)
        self.assertIn("controller.prepare()", source)
        self.assertIn("controller.exportPrepared()", source)
        self.assertIn("Salvar em Downloads", source)

    def test_absence_of_observation_is_not_rendered_as_health(self):
        source = self.source()
        self.assertIn("esta ausência não é prova de que o sistema esteja sem problemas", source)
        self.assertIn("Isso não é um atestado geral de saúde", source)
        self.assertIn("Isso não prova falha do supervisor", source)
        self.assertNotIn("Nenhum problema registrado", source)
        self.assertNotIn("Operando normalmente", source)
        self.assertNotIn("Sistema saudável", source)

    def test_partial_and_stale_states_are_first_class(self):
        source = self.source()
        self.assertIn("Revisão parcial", source)
        self.assertIn("Observação antiga", source)
        self.assertIn("Atualidade desconhecida", source)
        self.assertIn("Persistência degradada", source)
        self.assertIn("Somente nesta sessão", source)
        self.assertIn("Falha na leitura", source)

    def test_view_does_not_hide_administrative_controls_inside_diagnostics(self):
        lowered = self.source().lower()
        self.assertNotIn("reboot", lowered)
        self.assertNotIn("poweroff", lowered)
        self.assertNotIn("restart service", lowered)
        self.assertNotIn("ssh", lowered)
        self.assertNotIn("terminal", lowered)
        self.assertNotIn("remote shell", lowered)

    def test_view_never_uses_raw_serialized_document_as_primary_review(self):
        source = self.source()
        self.assertNotIn("document.text", source)
        self.assertIn("review.manifest.sources", source)
        self.assertIn("journal.events", source)
        self.assertIn("review.observations.updateFreshness", source)


if __name__ == "__main__":
    unittest.main()
