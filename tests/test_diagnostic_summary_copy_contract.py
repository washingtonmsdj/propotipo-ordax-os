from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "diagnostic-copy.mjs"
SUMMARY = ROOT / "system" / "services" / "diagnostics" / "summary.mjs"
COPY = ROOT / "system" / "services" / "diagnostics" / "copy.mjs"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "diagnostic-copy.mjs"


class DiagnosticSummaryCopyContractTests(unittest.TestCase):
    def test_contract_is_narrow_and_bounded(self):
        source = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('DIAGNOSTIC_COPY_SCHEMA = "ordax.diagnostic-copy/1"', source)
        self.assertIn('DIAGNOSTIC_SUMMARY_SCHEMA = "ordax.diagnostic-summary/1"', source)
        self.assertIn("MAX_DIAGNOSTIC_SUMMARY_TEXT_CHARS", source)
        self.assertIn('typeof port.copy !== "function"', source)
        self.assertNotIn("save(", source)
        self.assertNotIn("send(", source)
        self.assertNotIn("fetch(", source)

    def test_summary_rebuilds_from_structured_review_not_serialized_json(self):
        source = SUMMARY.read_text(encoding="utf-8")
        self.assertIn("document.review", source)
        self.assertNotIn("document.text", source)
        self.assertIn("redactDiagnosticText", source)
        self.assertIn("A ausência do registro não comprova ausência de problemas", source)
        self.assertIn("isso não é um atestado geral de saúde", source)
        self.assertIn("Isso não prova falha do supervisor", source)
        self.assertNotIn("Sistema saudável", source)
        self.assertNotIn("Nenhum problema registrado", source)

    def test_copy_service_never_exports_exception_text(self):
        source = COPY.read_text(encoding="utf-8")
        self.assertIn('copyResult("failed", "copy-failed")', source)
        self.assertNotIn("error.message", source)
        self.assertNotIn("String(error", source)
        self.assertNotIn("console.", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)

    def test_web_adapter_uses_only_explicit_clipboard_write(self):
        source = WEB_ADAPTER.read_text(encoding="utf-8")
        self.assertIn("clipboard.writeText", source)
        self.assertIn("validateDiagnosticSummary", source)
        self.assertNotIn("execCommand", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("innerHTML", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)


if __name__ == "__main__":
    unittest.main()
