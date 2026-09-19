from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "apps" / "files" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "apps" / "files" / "files.css"


class FilesCurrentFolderSearchTests(unittest.TestCase):
    def test_search_is_local_bounded_and_explicitly_scoped(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('const FILE_SEARCH_LOCALE = "pt-BR"', controls)
        self.assertIn("visibleEntries", controls)
        self.assertIn("toLocaleLowerCase(FILE_SEARCH_LOCALE)", controls)
        self.assertIn('searchInput.maxLength = 120', controls)
        self.assertIn('searchInput.placeholder = "Buscar nesta pasta"', controls)
        self.assertIn("searchInput.dataset.fileSearch", controls)
        self.assertIn("busca nesta pasta", controls)
        self.assertIn("Nenhum item corresponde à busca nesta pasta.", controls)
        self.assertNotIn("fileSpace.search", controls)
        self.assertNotIn("port.search", controls)

    def test_filter_has_clear_and_keyboard_escape_paths(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("clearSearch.dataset.fileSearchClear", controls)
        self.assertIn('event.target.matches?.("[data-file-search]")', controls)
        self.assertIn('event.key === "Escape" && searchQuery', controls)
        self.assertIn("selectionIsVisible()", controls)
        self.assertIn('node(documentObject, "div", "ordax-files-search")', controls)
        self.assertIn("setSelectionRange?.(caret, caret)", controls)

    def test_search_layout_is_responsive(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn(".ordax-files-search {", css)
        self.assertIn(".ordax-files-search-input", css)
        self.assertIn(".ordax-files-search-clear", css)
        self.assertIn("width: 100%;", css)


if __name__ == "__main__":
    unittest.main()
