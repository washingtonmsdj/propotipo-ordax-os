from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "notes-file-importer.mjs"
ACTION = ROOT / "system" / "surface" / "ui" / "file-notes-action.mjs"
FILES_OWNER = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class FileNotesActionContractTests(unittest.TestCase):
    def test_importer_contract_is_narrow_and_result_is_bounded(self):
        source = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('NOTES_FILE_IMPORTER_SCHEMA = "ordax.notes-file-importer/1"', source)
        self.assertIn("importTextFile", source)
        self.assertIn("validateNotesFileImportResult", source)
        self.assertIn('"created"', source)
        self.assertIn('"failed"', source)
        self.assertNotIn("readTextFile", source)
        self.assertNotIn("createNote", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("fetch(", source)

    def test_surface_action_depends_only_on_neutral_contracts(self):
        source = ACTION.read_text(encoding="utf-8")
        self.assertIn("assertNotesFileImporter", source)
        self.assertIn("validateNotesFileImportResult", source)
        self.assertIn("validateFileSpacePath", source)
        self.assertNotIn("services/notes", source)
        self.assertNotIn("services/files/notes-import", source)
        self.assertNotIn("adapters/", source)
        self.assertNotIn("navigator", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("fetch(", source)

    def test_files_owner_exposes_optional_action_without_owning_notes_runtime(self):
        source = FILES_OWNER.read_text(encoding="utf-8")
        self.assertIn("resources?.notesFileImporter ?? null", source)
        self.assertIn("assertNotesFileImporter(notesFileImporter)", source)
        self.assertIn("createFileNotesActionPresentation", source)
        self.assertIn("importSelectedFileToNotes", source)
        self.assertIn("dataset.fileCreateNote", source)
        self.assertIn("createNoteFromSelected", source)
        self.assertIn('activationPort.publish({ appId: "notes", target: null })', source)
        self.assertNotIn("createNotesRuntime", source)
        self.assertNotIn("createNotesFileImporter", source)
        self.assertNotIn("services/notes", source)
        self.assertNotIn("services/files/notes-import", source)

    def test_source_file_semantics_are_explicit_in_user_messages(self):
        source = ACTION.read_text(encoding="utf-8")
        self.assertIn("preserva o arquivo original", source)
        self.assertIn("arquivo original não foi alterado", source)
        self.assertIn("persistência no dispositivo está degradada", source)
        self.assertIn("somente nesta sessão", source)
        self.assertNotIn("Abrir com Notas", source)

    def test_surface_candidate_owns_contract_action_and_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("system/contracts/notes-file-importer.mjs"), 2)
        self.assertGreaterEqual(workflow.count("tests/test_file_notes_action.mjs"), 3)
        self.assertGreaterEqual(workflow.count("tests/test_file_notes_action_contract.py"), 2)
        self.assertIn("node --test tests/test_file_notes_action.mjs", workflow)
        self.assertIn(
            "python -m unittest tests.test_file_notes_action_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
