from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "system" / "services" / "diagnostics" / "controller.mjs"


class DiagnosticReviewControllerContractTests(unittest.TestCase):
    def source(self):
        return CONTROLLER.read_text(encoding="utf-8")

    def test_controller_stays_provider_and_platform_neutral(self):
        source = self.source()
        self.assertIn('from "./review.mjs"', source)
        self.assertIn('from "./copy.mjs"', source)
        self.assertIn('from "./export.mjs"', source)
        self.assertIn("createDiagnosticReviewDocument", source)
        self.assertIn("copyDiagnosticReviewSummary", source)
        self.assertIn("exportDiagnosticDocument", source)
        self.assertNotIn("adapters/native", source)
        self.assertNotIn("adapters/web", source)
        self.assertNotIn("/__ordax/native/", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("window.", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("navigator.clipboard", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)

    def test_output_actions_require_a_prepared_review_and_have_stable_failure_codes(self):
        source = self.source()
        self.assertIn('"review-not-prepared"', source)
        self.assertIn('"copy-unavailable"', source)
        self.assertIn('"copy-in-progress"', source)
        self.assertIn('"copy-failed"', source)
        self.assertIn('"export-unavailable"', source)
        self.assertIn('"export-in-progress"', source)
        self.assertIn('"review-prepare-failed"', source)
        self.assertIn('exportResult.status === "saved"', source)
        self.assertIn("preparedDocument = null", source)

    def test_new_prepare_invalidates_older_material(self):
        source = self.source()
        self.assertIn("const requestGeneration = ++generation", source)
        self.assertIn("requestGeneration !== generation", source)
        self.assertIn('return result("superseded")', source)

    def test_controller_does_not_accept_external_documents_for_copy_or_export(self):
        source = self.source()
        self.assertIn("async copyPreparedSummary()", source)
        self.assertIn("async exportPrepared()", source)
        self.assertNotIn("async copyPreparedSummary(document", source)
        self.assertNotIn("async exportPrepared(document", source)
        self.assertGreaterEqual(source.count("const document = preparedDocument"), 2)

    def test_controller_exposes_neutral_observable_state(self):
        source = self.source()
        self.assertIn('ordax.diagnostic-review-controller-state/1', source)
        self.assertIn("getSnapshot()", source)
        self.assertIn("subscribe(listener)", source)
        self.assertIn('updateState("preparing", null)', source)
        self.assertIn('updateState("copying", null)', source)
        self.assertIn('updateState("exporting", null)', source)
        self.assertIn("copyAvailable: copyPort !== null", source)
        self.assertIn("exportAvailable: exportPort !== null", source)
        self.assertIn("document: preparedDocument", source)
        self.assertIn("lastResult", source)

    def test_presentation_subscriber_failures_are_isolated(self):
        source = self.source()
        self.assertIn("Presentation subscribers must never break", source)
        self.assertIn("A subscriber failure is isolated", source)
        self.assertNotIn("console.", source)


if __name__ == "__main__":
    unittest.main()
