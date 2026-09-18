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
        self.assertIn('from "./export.mjs"', source)
        self.assertIn("createDiagnosticReviewDocument", source)
        self.assertIn("exportDiagnosticDocument", source)
        self.assertNotIn("adapters/native", source)
        self.assertNotIn("/__ordax/native/", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("window.", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)

    def test_export_requires_a_prepared_review_and_has_stable_failure_codes(self):
        source = self.source()
        self.assertIn('"review-not-prepared"', source)
        self.assertIn('"export-unavailable"', source)
        self.assertIn('"export-in-progress"', source)
        self.assertIn('"review-prepare-failed"', source)
        self.assertIn('status === "saved"', source)
        self.assertIn("preparedDocument = null", source)

    def test_new_prepare_invalidates_older_material(self):
        source = self.source()
        self.assertIn("const requestGeneration = ++generation", source)
        self.assertIn("requestGeneration !== generation", source)
        self.assertIn('return result("superseded")', source)

    def test_controller_does_not_accept_a_document_for_export(self):
        source = self.source()
        self.assertIn("async exportPrepared()", source)
        self.assertNotIn("async exportPrepared(document", source)
        self.assertIn("const document = preparedDocument", source)

    def test_controller_exposes_neutral_observable_state(self):
        source = self.source()
        self.assertIn('ordax.diagnostic-review-controller-state/1', source)
        self.assertIn("getSnapshot()", source)
        self.assertIn("subscribe(listener)", source)
        self.assertIn('updateState("preparing", null)', source)
        self.assertIn('updateState("exporting", null)', source)
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
