from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class ProjectFilesUiContractTests(unittest.TestCase):
    def test_shared_files_owner_consumes_neutral_project_catalog(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('from "../../contracts/project-catalog.mjs"', controls)
        self.assertIn("assertProjectCatalogPort", controls)
        self.assertIn("dataset.fileOpenProject", controls)
        self.assertIn("dataset.fileProjectCreateStart", controls)
        self.assertIn("dataset.fileProjectName", controls)
        self.assertIn("dataset.fileProjectCreate", controls)
        self.assertIn("dataset.fileProjectRenameStart", controls)
        self.assertIn("dataset.fileProjectRenameName", controls)
        self.assertIn("dataset.fileProjectRenameConfirm", controls)
        self.assertIn("dataset.fileProjectRenameCancel", controls)
        self.assertIn("dataset.fileProjectRemove", controls)
        self.assertIn("projectPort.rename(renamingProjectId, projectRenameDraft)", controls)
        self.assertIn("projectPort.recordOpened(projectId)", controls)
        self.assertIn("projectPort.remove(projectId)", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("/__ordax/native/", controls)

    def test_project_rename_changes_catalog_label_without_renaming_folder(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        rename_block = controls.split("  const renameProject = () => {", 1)[1].split(
            "  const openProject =", 1
        )[0]
        self.assertIn("projectPort.rename(renamingProjectId, projectRenameDraft)", rename_block)
        self.assertNotIn("port.renameEntry(", rename_block)
        self.assertIn("project.path !== listing.path", rename_block)
        self.assertIn("A pasta continua em", rename_block)
        self.assertIn("Isso altera apenas o nome do projeto. A pasta continua em", controls)

    def test_project_rename_is_keyboard_accessible_and_navigation_invalidates_draft(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('requestFocus("project-rename-name", project.id)', controls)
        self.assertIn('event.target.matches?.("[data-file-project-rename-name]")', controls)
        self.assertIn('event.key === "Enter"', controls)
        self.assertIn('event.key === "Escape"', controls)
        changed_path_block = controls.split("      if (changedPath) {", 1)[1].split(
            "      listing = next;", 1
        )[0]
        self.assertIn("renamingProjectId = null;", changed_path_block)
        self.assertIn('projectRenameDraft = "";', changed_path_block)

    def test_native_composition_injects_project_runtime_only_into_files_owner(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeProjectStore", composition)
        self.assertIn("createProjectCatalogRuntime", composition)
        self.assertIn("const projects = fileSpace === null ? null", composition)
        self.assertIn("{ recentFiles, projects }", composition)
        self.assertNotIn("createNativeProjectStore", (ROOT / "system" / "composition" / "web" / "main.mjs").read_text(encoding="utf-8"))

    def test_surface_candidate_owns_project_catalog_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("system/contracts/project-catalog.mjs"), 2)
        self.assertGreaterEqual(workflow.count("system/contracts/project-store.mjs"), 2)
        self.assertGreaterEqual(workflow.count("tests/test_projects.mjs"), 3)
        self.assertGreaterEqual(workflow.count("tests/test_project_files_ui_contract.py"), 2)
        self.assertIn(
            "python -m unittest tests.test_project_files_ui_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
