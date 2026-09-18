from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTICS = ROOT / "system" / "services" / "diagnostics"
REPORT = DIAGNOSTICS / "report.mjs"
REDACTION = DIAGNOSTICS / "redaction.mjs"
JOURNAL = DIAGNOSTICS / "journal.mjs"
RUNTIME = DIAGNOSTICS / "runtime.mjs"


class DiagnosticReportContractTests(unittest.TestCase):
    def read(self, path):
        return path.read_text(encoding="utf-8")

    def test_report_stays_shared_and_platform_neutral(self):
        report = self.read(REPORT)
        self.assertIn("validateSurfaceSnapshot", report)
        self.assertIn("validateSystemMetricsSnapshot", report)
        self.assertIn("validateUpdateHistorySnapshot", report)
        self.assertIn("validateUpdateStatusSnapshot", report)
        self.assertIn("validateDiagnosticJournalRuntimeSnapshot", report)
        self.assertNotIn("adapters/native", report)
        self.assertNotIn("/__ordax/native/", report)
        self.assertNotIn("fetch(", report)
        self.assertNotIn("window.", report)
        self.assertNotIn("document.", report)

    def test_redaction_policy_has_one_shared_owner(self):
        report = self.read(REPORT)
        journal = self.read(JOURNAL)
        redaction = self.read(REDACTION)

        self.assertIn('from "./redaction.mjs"', report)
        self.assertIn('from "./redaction.mjs"', journal)
        self.assertNotIn("export function redactDiagnosticText", report)
        self.assertNotIn('from "./report.mjs"', journal)
        self.assertIn("export const MAX_DIAGNOSTIC_TEXT = 1000", redaction)
        self.assertIn("export function redactDiagnosticText", redaction)
        self.assertIn('"Bearer [redacted]"', redaction)
        self.assertIn('"[user-path]"', redaction)
        self.assertIn('"[email]"', redaction)
        self.assertIn('"[ip]"', redaction)

    def test_report_v2_is_reviewable_redacted_and_allowlisted(self):
        report = self.read(REPORT)
        self.assertIn('ordax.diagnostic-report/2', report)
        self.assertIn('scope: "local-reviewable"', report)
        self.assertIn("journal: summarizeJournal(journal)", report)
        self.assertIn("eventCount: snapshot.events.length", report)
        self.assertIn("configuredStoreScope: snapshot.configuredStoreScope", report)
        self.assertIn("persistenceStatus: snapshot.persistenceStatus", report)
        self.assertIn("persistenceErrorCode: snapshot.persistenceErrorCode", report)
        self.assertIn("correlationKey: entry.correlationKey", report)
        self.assertIn("message: redactDiagnosticText(entry.message)", report)
        self.assertIn("healthTokenPresent", report)
        self.assertNotIn("healthToken: snapshot.healthToken", report)
        self.assertNotIn("healthToken: value.healthToken", report)
        self.assertIn("lastError: redactDiagnosticText(snapshot.lastError)", report)

    def test_runtime_snapshot_validation_is_canonical_and_fail_closed(self):
        runtime = self.read(RUNTIME)
        self.assertIn("export function validateDiagnosticJournalRuntimeSnapshot", runtime)
        self.assertIn('new Set(["device", "session", "degraded"])', runtime)
        self.assertIn('new Set(["", "load-failed", "save-failed"])', runtime)
        self.assertIn("value.events.length > retentionLimit", runtime)
        self.assertIn("Healthy diagnostic persistence must match configured store scope", runtime)
        self.assertIn("Degraded diagnostic persistence requires an error code", runtime)
        self.assertIn("const snapshot = () => validateDiagnosticJournalRuntimeSnapshot", runtime)

    def test_report_bounds_history_and_normalizes_capabilities(self):
        report = self.read(REPORT)
        self.assertIn("snapshot.releases.slice(0, 12)", report)
        self.assertIn("snapshot.applications.slice(0, 20)", report)
        self.assertIn("[...surfaceSnapshot.capabilityIds].sort()", report)

    def test_document_export_is_json_and_derived_from_validated_report(self):
        report = self.read(REPORT)
        self.assertIn("createDiagnosticReportDocument", report)
        self.assertIn("const report = createDiagnosticReport(input);", report)
        self.assertIn('mediaType: "application/json"', report)
        self.assertIn("ordax-diagnostico-${reportFileStamp(report.generatedAt)}.json", report)
        self.assertIn("JSON.stringify(report, null, 2)", report)
        self.assertNotIn("JSON.stringify(input", report)

    def test_report_does_not_introduce_remote_control_or_mutation(self):
        report = self.read(REPORT)
        lowered = report.lower()
        self.assertNotIn("ssh", lowered)
        self.assertNotIn("supabase", lowered)
        self.assertNotIn("remote shell", lowered)
        self.assertNotIn("reboot", lowered)
        self.assertNotIn("poweroff", lowered)
        self.assertNotIn("writefile", lowered)


if __name__ == "__main__":
    unittest.main()
