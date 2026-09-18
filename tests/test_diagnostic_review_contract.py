from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "system" / "services" / "diagnostics" / "review.mjs"


class DiagnosticReviewContractTests(unittest.TestCase):
    def read_review(self):
        return REVIEW.read_text(encoding="utf-8")

    def test_review_uses_only_neutral_ports_and_shared_services(self):
        source = self.read_review()
        self.assertIn("contracts/surface-host.mjs", source)
        self.assertIn("contracts/system-metrics.mjs", source)
        self.assertIn("contracts/update-history.mjs", source)
        self.assertIn("contracts/update-status.mjs", source)
        self.assertIn('from "../update/freshness.mjs"', source)
        self.assertIn('from "./report.mjs"', source)
        self.assertIn('from "./runtime.mjs"', source)
        self.assertNotIn("adapters/native", source)
        self.assertNotIn("/__ordax/native/", source)

    def test_review_is_explicit_and_has_no_background_or_export_side_effect(self):
        source = self.read_review()
        self.assertIn("export async function createDiagnosticReview", source)
        self.assertIn("export async function createDiagnosticReviewDocument", source)
        self.assertNotIn("setInterval", source)
        self.assertNotIn("setTimeout", source)
        self.assertNotIn("requestAnimationFrame", source)
        self.assertNotIn("addEventListener", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("window.", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("writeFile", source)

    def test_manifest_uses_stable_failure_codes_not_exception_messages(self):
        source = self.read_review()
        for code in (
            "surface-read-failed",
            "update-read-failed",
            "metrics-read-failed",
            "history-read-failed",
            "journal-read-failed",
        ):
            self.assertIn(code, source)
        self.assertNotIn("error.message", source)
        self.assertNotIn("String(error)", source)
        self.assertIn("includedSourceIds", source)
        self.assertIn("unavailableSourceIds", source)
        self.assertIn("failedSourceIds", source)
        self.assertIn("hasFailures", source)

    def test_failed_surface_falls_back_to_explicit_unknown_not_fake_health(self):
        source = self.read_review()
        self.assertIn('connectivity: "unknown"', source)
        self.assertIn("capabilityIds: Object.freeze([])", source)
        self.assertNotIn("healthy", source.lower())
        self.assertNotIn("operando normalmente", source.lower())


if __name__ == "__main__":
    unittest.main()
