from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
SERVICE = ROOT / "system" / "services" / "files" / "recent-files.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "recent-files.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class RecentFilesUiContractTests(unittest.TestCase):
    def test_shared_owner_consumes_neutral_recent_files_port_without_storage_shortcut(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('from "../../contracts/recent-files.mjs"', controls)
        self.assertIn("assertRecentFilesPort", controls)
        self.assertIn("dataset.fileOpenRecent", controls)
        self.assertIn("dataset.fileRecentPath", controls)
        self.assertIn("recentPort.recordOpened(next.path)", controls)
        self.assertIn("recentPort.remove(selected.path)", controls)
        self.assertIn("recentPort.clear()", controls)
        self.assertIn("recentPort.relocate(previousPath, nextPath)", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("adapters/native", controls)

    def test_recent_history_policy_stays_out_of_native_adapter(self):
        service = SERVICE.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn("MAX_RECENT_FILES", service)
        self.assertIn("recordOpened(path)", service)
        self.assertIn("relocate(fromPath, toPath)", service)
        self.assertIn("ordax.native.recent-files.v1", adapter)
        self.assertIn("localStorage", adapter)
        self.assertNotIn("MAX_RECENT_FILES", adapter)
        self.assertNotIn("surface/ui", adapter)

    def test_native_composition_injects_recent_runtime_only_into_files_owner(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeRecentFilesStore", composition)
        self.assertIn("createRecentFilesRuntime", composition)
        self.assertIn("const recentFiles = fileSpace === null ? null", composition)
        self.assertIn(
            "{ recentFiles, projects }",
            composition,
        )

    def test_surface_candidate_owns_recent_files_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("system/services/files/**", workflow)
        self.assertIn("tests/test_recent_files.mjs", workflow)
        self.assertIn("tests/test_recent_files_ui_contract.py", workflow)
        self.assertIn("node --test tests/test_recent_files.mjs", workflow)
        self.assertIn("python -m unittest tests.test_recent_files_ui_contract -v", workflow)


if __name__ == "__main__":
    unittest.main()
