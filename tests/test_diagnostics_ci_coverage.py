from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class DiagnosticsCiCoverageTests(unittest.TestCase):
    def workflow(self):
        return WORKFLOW.read_text(encoding="utf-8")

    def test_diagnostics_source_and_contract_trigger_web_contract_ci(self):
        workflow = self.workflow()
        self.assertEqual(workflow.count("- 'docs/contracts/diagnostics.json'"), 2)
        self.assertEqual(workflow.count("- 'system/contracts/diagnostic-journal-store.mjs'"), 2)
        self.assertEqual(workflow.count("- 'system/contracts/diagnostic-export.mjs'"), 2)
        self.assertEqual(workflow.count("- 'system/services/diagnostics/**'"), 2)

    def test_diagnostics_modules_are_in_zero_dependency_syntax_scan(self):
        workflow = self.workflow()
        self.assertIn("            system/services/diagnostics \\", workflow)

    def test_behavioral_diagnostics_tests_are_owned_by_the_workflow(self):
        workflow = self.workflow()
        self.assertEqual(workflow.count("- 'tests/test_client_diagnostics.mjs'"), 2)
        self.assertEqual(workflow.count("- 'tests/test_diagnostic_*.mjs'"), 2)
        self.assertIn("node --test tests/test_client_diagnostics.mjs", workflow)
        self.assertIn("node --test tests/test_diagnostic_*.mjs", workflow)

    def test_python_diagnostics_regressions_also_trigger_the_workflow(self):
        workflow = self.workflow()
        self.assertEqual(workflow.count("- 'tests/test_diagnostic_*.py'"), 2)
        self.assertEqual(workflow.count("- 'tests/test_diagnostics_contract.py'"), 2)


if __name__ == "__main__":
    unittest.main()
