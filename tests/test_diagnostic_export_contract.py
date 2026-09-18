from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "diagnostic-export.mjs"
SERVICE = ROOT / "system" / "services" / "diagnostics" / "export.mjs"


class DiagnosticExportContractTests(unittest.TestCase):
    def test_contract_is_narrow_json_only_and_bounded(self):
        source = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('DIAGNOSTIC_EXPORT_SCHEMA = "ordax.diagnostic-export/1"', source)
        self.assertIn("MAX_DIAGNOSTIC_EXPORT_TEXT_CHARS = 2_000_000", source)
        self.assertIn('value.mediaType !== "application/json"', source)
        self.assertIn("value.fileName.includes(\"..\")", source)
        self.assertIn("validateDiagnosticExportSaveResult", source)
        self.assertIn('new Set(["saved", "cancelled"])', source)
        self.assertIn("save(document)", source)

    def test_service_delegates_io_and_has_no_hidden_export_mechanism(self):
        source = SERVICE.read_text(encoding="utf-8")
        self.assertIn("validateDiagnosticExportDocument", source)
        self.assertIn("assertDiagnosticExportPort", source)
        self.assertIn("await port.save(validatedDocument)", source)
        self.assertIn('exportResult("failed", "export-failed")', source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("window.", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("createObjectURL", source)
        self.assertNotIn("writeFile", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("setInterval", source)
        self.assertNotIn("setTimeout", source)

    def test_service_never_copies_adapter_exception_text(self):
        source = SERVICE.read_text(encoding="utf-8")
        self.assertNotIn("error.message", source)
        self.assertNotIn("String(error)", source)
        self.assertNotIn("catch (error)", source)


if __name__ == "__main__":
    unittest.main()
