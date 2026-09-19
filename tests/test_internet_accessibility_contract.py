from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "internet-browser-controls.mjs"
STYLES = ROOT / "system" / "surface" / "ui" / "internet.css"


def relative_luminance(color):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]

    def linear(channel):
        if channel <= 0.04045:
            return channel / 12.92
        return ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = [linear(channel) for channel in channels]
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(foreground, background):
    lighter, darker = sorted(
        (relative_luminance(foreground), relative_luminance(background)),
        reverse=True,
    )
    return (lighter + 0.05) / (darker + 0.05)


class InternetAccessibilityContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_navigation_toolbar_and_project_panel_expose_relationships(self):
        controls = self.text(CONTROLS)
        self.assertIn('toolbar.setAttribute("role", "toolbar")', controls)
        self.assertIn('toolbar.setAttribute("aria-label", "Navegação da Internet")', controls)
        self.assertIn('more.setAttribute("aria-controls", PROJECT_PANEL_ID)', controls)
        self.assertIn('more.setAttribute("aria-expanded", "true")', controls)
        self.assertIn('panel.id = PROJECT_PANEL_ID', controls)
        self.assertIn('toggle?.setAttribute("aria-expanded", String(!panelCollapsed))', controls)

    def test_tabs_use_real_sibling_buttons_without_nested_interactive_roles(self):
        controls = self.text(CONTROLS)
        self.assertIn('tabs.setAttribute("role", "tablist")', controls)
        self.assertIn('tabs.setAttribute("aria-orientation", "vertical")', controls)
        self.assertIn('const row = node(documentObject, "div", "ordax-internet-tab")', controls)
        self.assertIn('row.setAttribute("role", "presentation")', controls)
        self.assertIn('const activate = node(documentObject, "button", "ordax-internet-tab-activate")', controls)
        self.assertIn('activate.setAttribute("role", "tab")', controls)
        self.assertIn('activate.setAttribute("aria-selected"', controls)
        self.assertIn('activate.tabIndex', controls)
        self.assertIn('const activeVisible = filteredTabs.some', controls)
        self.assertIn('!activeVisible && tab.id === filteredTabs[0]?.id', controls)
        self.assertIn('const close = node(documentObject, "button", "ordax-internet-tab-close", "×")', controls)
        self.assertIn('close.type = "button"', controls)
        self.assertNotIn('close.setAttribute("role", "button")', controls)

    def test_tablist_supports_keyboard_navigation_focus_recovery_and_cleanup(self):
        controls = self.text(CONTROLS)
        self.assertIn('const onKeyDown = (event) =>', controls)
        for key in ("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"):
            self.assertIn(f'event.key === "{key}"', controls)
        self.assertIn('event.key === "Escape" && tabQuery', controls)
        self.assertIn('port.activateTab(nextId)', controls)
        self.assertIn('focusTab(nextId)', controls)
        self.assertIn('pendingTabFocusId', controls)
        self.assertIn('focusProject(projectId)', controls)
        self.assertIn('root.addEventListener("keydown", onKeyDown)', controls)
        self.assertIn('root.removeEventListener("keydown", onKeyDown)', controls)

    def test_dynamic_feedback_is_announced_without_stealing_focus(self):
        controls = self.text(CONTROLS)
        self.assertIn('status.setAttribute("role", "status")', controls)
        self.assertIn('status.setAttribute("aria-live", "polite")', controls)
        self.assertNotIn('alert(', controls)

    def test_focus_indicators_and_secondary_text_meet_contrast_direction(self):
        styles = self.text(STYLES)
        self.assertIn('.ordax-internet-view button:focus-visible', styles)
        self.assertIn('outline: 3px solid #9d2f18', styles)
        self.assertIn('outline-offset: 2px', styles)
        self.assertIn('color: #5f5b54', styles)
        self.assertIn('.ordax-internet-project-option[aria-pressed="true"]', styles)
        self.assertIn('.ordax-internet-tab-activate', styles)

        for surface in ("#efede6", "#f8f7f3"):
            with self.subTest(surface=surface, token="secondary-text"):
                self.assertGreaterEqual(contrast_ratio("#5f5b54", surface), 4.5)
            with self.subTest(surface=surface, token="focus-indicator"):
                self.assertGreaterEqual(contrast_ratio("#9d2f18", surface), 3.0)

    def test_responsive_layout_does_not_expose_controls_for_hidden_surfaces(self):
        styles = self.text(STYLES)
        self.assertIn('@media (max-width: 1020px)', styles)
        self.assertIn('.ordax-internet-project-panel { display: none; }', styles)
        self.assertIn('.ordax-internet-toolbar [data-browser-action="more"] { display: none; }', styles)
        self.assertIn('grid-template-columns: 32px 32px 32px minmax(140px, 1fr);', styles)
        self.assertIn('.ordax-internet-toolbar [data-browser-action="bookmark"]', styles)
        self.assertIn('.ordax-internet-toolbar [data-browser-action="downloads"] { display: none; }', styles)


if __name__ == "__main__":
    unittest.main()
