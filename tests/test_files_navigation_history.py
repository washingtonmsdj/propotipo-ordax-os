from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "apps" / "files" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "apps" / "files" / "files.css"


class FilesNavigationHistoryTests(unittest.TestCase):
    def test_navigation_history_is_bounded_and_window_local(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("MAX_NAVIGATION_HISTORY = 64", controls)
        self.assertIn("navigationHistory = []", controls)
        self.assertIn("navigationIndex = -1", controls)
        self.assertIn("recordNavigation", controls)
        self.assertIn("slice(-MAX_NAVIGATION_HISTORY)", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)

    def test_back_forward_and_up_have_real_navigation_paths(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("back.dataset.fileHistoryBack", controls)
        self.assertIn("forward.dataset.fileHistoryForward", controls)
        self.assertIn("up.dataset.fileHistoryUp", controls)
        self.assertIn("navigateHistory(navigationIndex - 1)", controls)
        self.assertIn("navigateHistory(navigationIndex + 1)", controls)
        self.assertIn("load(parentPath(listing.path))", controls)
        self.assertIn('load(listing.path, { recordHistory: false })', controls)

    def test_failed_navigation_preserves_current_context(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        load_block = controls.split("const load = async", 1)[1].split("const navigateHistory", 1)[0]
        self.assertIn("const changedPath = Boolean(listing && listing.path !== next.path)", load_block)
        self.assertIn("if (changedPath)", load_block)
        self.assertIn('message = "Não foi possível abrir este local."', load_block)
        self.assertLess(load_block.index("const next = validateFileListing"), load_block.index("searchQuery = \"\""))

    def test_navigation_controls_are_accessible_and_responsive(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('back.setAttribute("aria-label", "Voltar")', controls)
        self.assertIn('forward.setAttribute("aria-label", "Avançar")', controls)
        self.assertIn('up.setAttribute("aria-label", "Subir um nível")', controls)
        self.assertIn(".ordax-files-navigation", css)
        self.assertIn(".ordax-files-nav-action", css)


if __name__ == "__main__":
    unittest.main()
