from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "apps" / "files" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "apps" / "files" / "files.css"


class FilesSortingTests(unittest.TestCase):
    def test_sorting_uses_only_existing_contract_fields(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('let sortKey = "name"', controls)
        self.assertIn('let sortDirection = "asc"', controls)
        self.assertIn('["name", "type", "size", "modified"]', controls)
        self.assertIn('sortKey === "size"', controls)
        self.assertIn('sortKey === "modified"', controls)
        self.assertIn("modifiedAt", controls)

    def test_directories_stay_grouped_before_files(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('left.kind === "directory" ? -1 : 1', controls)
        self.assertIn("compareEntryNames", controls)
        self.assertIn("numeric: true", controls)
        self.assertIn('sensitivity: "base"', controls)

    def test_sort_buttons_are_accessible_and_toggle_direction(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("data.fileSortKey", controls.replace("dataset", "data"))
        self.assertIn('aria-pressed', controls)
        self.assertIn('sortDirection === "asc" ? "desc" : "asc"', controls)
        self.assertIn('sortButton("Nome", "name")', controls)
        self.assertIn('sortButton("Tipo", "type")', controls)
        self.assertIn('sortButton("Tamanho", "size")', controls)
        self.assertIn('sortButton("Modificado", "modified")', controls)

    def test_sort_controls_have_focus_and_direction_styles(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn(".ordax-files-sort {", css)
        self.assertIn(".ordax-files-sort:focus-visible", css)
        self.assertIn(".ordax-files-sort-indicator", css)


if __name__ == "__main__":
    unittest.main()
