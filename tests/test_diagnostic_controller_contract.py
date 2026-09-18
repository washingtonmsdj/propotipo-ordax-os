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
        self.assertIn('code: "review-not-prepared"', source)
        self.assertIn('code: "export-unavailable"', source)
        self.assertIn('code: "export-in-progress"', source)
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


if __name__ == "__main__":
    unittest.main()
