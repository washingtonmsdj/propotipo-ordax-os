from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "system" / "services" / "diagnostics" / "journal.mjs"


class DiagnosticJournalContractTests(unittest.TestCase):
    def read_journal(self):
        return JOURNAL.read_text(encoding="utf-8")

    def test_journal_is_shared_and_depends_only_on_safe_domain_inputs(self):
        journal = self.read_journal()
        self.assertIn("contracts/update-status.mjs", journal)
        self.assertIn('from "./report.mjs"', journal)
        self.assertNotIn("adapters/native", journal)
        self.assertNotIn("/__ordax/native/", journal)
        self.assertNotIn("fetch(", journal)
        self.assertNotIn("window.", journal)
        self.assertNotIn("document.", journal)

    def test_update_incident_correlation_prefers_attempt_then_stable_fallbacks(self):
        journal = self.read_journal()
        self.assertIn('return `update:attempt:${snapshot.attemptId}`', journal)
        self.assertIn('return `update:rejected:${snapshot.rejectedSha}`', journal)
        self.assertIn('return `update:target:${snapshot.targetSha}`', journal)
        self.assertIn('return `update:source:${snapshot.sourceSha}`', journal)
        self.assertNotIn("Date.now()", journal)
        self.assertNotIn("Math.random()", journal)

    def test_journal_is_bounded_and_keeps_latest_events(self):
        journal = self.read_journal()
        self.assertIn("DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT = 100", journal)
        self.assertIn("MAX_DIAGNOSTIC_JOURNAL_LIMIT = 500", journal)
        self.assertIn("validated.slice(-boundedLimit)", journal)
        self.assertIn("rotateDiagnosticEvents", journal)
        self.assertIn("appendDiagnosticEvent", journal)

    def test_event_text_is_redacted_and_health_token_is_not_part_of_event(self):
        journal = self.read_journal()
        self.assertIn("redactDiagnosticText(snapshot.lastError)", journal)
        self.assertIn("redactDiagnosticText(value.message", journal)
        self.assertNotIn("healthToken", journal)
        self.assertNotIn("secret", journal.lower())
        self.assertNotIn("password", journal.lower())

    def test_journal_does_not_add_remote_or_host_mutation(self):
        journal = self.read_journal().lower()
        self.assertNotIn("ssh", journal)
        self.assertNotIn("supabase", journal)
        self.assertNotIn("reboot", journal)
        self.assertNotIn("poweroff", journal)
        self.assertNotIn("writefile", journal)


if __name__ == "__main__":
    unittest.main()
