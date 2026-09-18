from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"
FRESHNESS = ROOT / "system" / "services" / "update" / "freshness.mjs"


class UpdateServiceCiOwnershipTests(unittest.TestCase):
    def test_surface_web_candidate_owns_shared_update_services(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        push, rest = workflow.split("  pull_request:\n", 1)
        pull_request, _ = rest.split("  workflow_dispatch:\n", 1)

        self.assertIn("- 'system/services/update/**'", push)
        self.assertIn("- 'system/services/update/**'", pull_request)
        self.assertIn("- 'tests/test_update_*.mjs'", push)
        self.assertIn("- 'tests/test_update_*.mjs'", pull_request)
        self.assertIn("system/services/update \\", workflow)
        self.assertIn("node --test tests/test_update_*.mjs", workflow)

    def test_freshness_service_remains_platform_neutral(self):
        source = FRESHNESS.read_text(encoding="utf-8")
        self.assertIn("contracts/update-status.mjs", source)
        self.assertIn("evaluateUpdateStateFreshness", source)
        self.assertNotIn("adapters/native", source)
        self.assertNotIn("/__ordax/native/", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("window.", source)
        self.assertNotIn("document.", source)


if __name__ == "__main__":
    unittest.main()
