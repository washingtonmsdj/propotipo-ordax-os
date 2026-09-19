from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "system" / "apps" / "notes" / "services" / "file-import.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class FilesToNotesImportContractTests(unittest.TestCase):
    def source(self):
        return SERVICE.read_text(encoding="utf-8")

    def test_import_uses_bounded_shared_ports_only(self):
        source = self.source()
        self.assertIn("assertFileSpacePort", source)
        self.assertIn("assertNotesRuntime", source)
        self.assertIn("files.readTextFile(path)", source)
        self.assertIn("MAX_NOTE_TEXT_CHARS", source)
        self.assertNotIn("adapters/", source)
        self.assertNotIn("fetch(", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)

    def test_import_never_mutates_the_source_file(self):
        source = self.source()
        for forbidden in (
            "files.importFile(",
            "files.moveEntry(",
            "files.copyFile(",
            "files.renameEntry(",
            "files.createDirectory(",
        ):
            self.assertNotIn(forbidden, source)

    def test_import_is_explicit_about_copy_semantics_and_origin(self):
        source = self.source()
        self.assertIn('kind: "file"', source)
        self.assertIn("detail: path", source)
        self.assertIn("path,", source)
        self.assertIn("title: name", source)
        self.assertIn("body: source.text", source)
        self.assertNotIn("slice(0, MAX_NOTE_TEXT_CHARS)", source)
        self.assertIn('code: "source-too-large"', source)

    def test_operational_failures_expose_stable_codes_not_exception_text(self):
        source = self.source()
        for code in (
            "source-read-failed",
            "source-mismatch",
            "source-too-large",
            "source-reference-too-long",
            "notes-project-unavailable",
            "notes-create-failed",
        ):
            self.assertIn(f'"{code}"', source)
        self.assertNotIn("error.message", source)
        self.assertNotIn("String(error)", source)
        self.assertIn("exception text is never returned", source)

    def test_notes_app_owns_the_import_service_and_surface_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("system/apps/**"), 2)
        self.assertGreaterEqual(workflow.count("system/services/files/**"), 2)
        self.assertGreaterEqual(workflow.count("tests/test_files_to_notes_import.mjs"), 3)
        self.assertGreaterEqual(workflow.count("tests/test_files_to_notes_import_contract.py"), 2)
        self.assertIn("node --test tests/test_files_to_notes_import.mjs", workflow)
        self.assertIn(
            "python -m unittest tests.test_files_to_notes_import_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
