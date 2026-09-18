from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "system" / "services" / "diagnostics" / "report.mjs"


class DiagnosticReportContractTests(unittest.TestCase):
    def read_report(self):
        return REPORT.read_text(encoding="utf-8")

    def test_report_stays_shared_and_platform_neutral(self):
        report = self.read_report()
        self.assertIn("validateSurfaceSnapshot", report)
        self.assertIn("validateSystemMetricsSnapshot", report)
        self.assertIn("validateUpdateHistorySnapshot", report)
        self.assertIn("validateUpdateStatusSnapshot", report)
        self.assertNotIn("adapters/native", report)
        self.assertNotIn("/__ordax/native/", report)
        self.assertNotIn("fetch(", report)
        self.assertNotIn("window.", report)
        self.assertNotIn("document.", report)

    def test_report_is_reviewable_redacted_and_allowlisted(self):
        report = self.read_report()
        self.assertIn('ordax.diagnostic-report/1', report)
        self.assertIn('scope: "local-reviewable"', report)
        self.assertIn("MAX_DIAGNOSTIC_TEXT", report)
        self.assertIn("redactDiagnosticText", report)
        self.assertIn('"Bearer [redacted]"', report)
        self.assertIn('"[user-path]"', report)
        self.assertIn('"[email]"', report)
        self.assertIn('"[ip]"', report)
        self.assertIn("healthTokenPresent", report)
        self.assertNotIn("healthToken: snapshot.healthToken", report)
        self.assertNotIn("healthToken: value.healthToken", report)
        self.assertIn("lastError: redactDiagnosticText(snapshot.lastError)", report)

    def test_report_bounds_history_and_normalizes_capabilities(self):
        report = self.read_report()
        self.assertIn("snapshot.releases.slice(0, 12)", report)
        self.assertIn("snapshot.applications.slice(0, 20)", report)
        self.assertIn("[...surfaceSnapshot.capabilityIds].sort()", report)

    def test_document_export_is_json_and_derived_from_redacted_report(self):
        report = self.read_report()
        self.assertIn("createDiagnosticReportDocument", report)
        self.assertIn("const report = createDiagnosticReport(input);", report)
        self.assertIn('mediaType: "application/json"', report)
        self.assertIn("ordax-diagnostico-${reportFileStamp(report.generatedAt)}.json", report)
        self.assertIn("JSON.stringify(report, null, 2)", report)
        self.assertNotIn("JSON.stringify(input", report)

    def test_report_does_not_introduce_remote_control_or_mutation(self):
        report = self.read_report()
        lowered = report.lower()
        self.assertNotIn("ssh", lowered)
        self.assertNotIn("supabase", lowered)
        self.assertNotIn("remote shell", lowered)
        self.assertNotIn("reboot", lowered)
        self.assertNotIn("poweroff", lowered)
        self.assertNotIn("writefile", lowered)


if __name__ == "__main__":
    unittest.main()
