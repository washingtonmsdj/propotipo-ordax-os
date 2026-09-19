from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "system" / "adapters" / "native" / "diagnostic-copy.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "diagnostics.mjs"


class NativeDiagnosticCopyContractTests(unittest.TestCase):
    def test_adapter_is_a_narrow_clipboard_capability(self):
        source = ADAPTER.read_text(encoding="utf-8")
        self.assertIn("validateDiagnosticSummary", source)
        self.assertIn("clipboard.writeText(summary.text)", source)
        self.assertNotIn("document.", source)
        self.assertNotIn("execCommand", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("document.text", source)

    def test_native_review_composition_detects_clipboard_without_faking_support(self):
        source = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("clipboard = globalThis.navigator?.clipboard ?? null", source)
        self.assertIn("clipboard === null", source)
        self.assertIn("createNativeDiagnosticCopy(clipboard)", source)
        self.assertIn("diagnosticCopy,", source)
        self.assertNotIn("navigator.clipboard.writeText", source)
        self.assertNotIn("execCommand", source)


if __name__ == "__main__":
    unittest.main()
