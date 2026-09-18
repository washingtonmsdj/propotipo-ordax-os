from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"
SURFACE_CSS = ROOT / "system" / "surface" / "ui" / "surface.css"


class SurfaceReconciliationContractTests(unittest.TestCase):
    def read_surface(self):
        return SURFACE.read_text(encoding="utf-8")

    def test_interactive_collections_are_not_rebuilt_destructively(self):
        surface = self.read_surface()
        self.assertEqual(
            surface.count("replaceChildren()"),
            1,
            "only final Surface teardown may replace the root children",
        )
        self.assertNotIn("windowLayer.replaceChildren()", surface)
        self.assertNotIn("appLauncher.replaceChildren()", surface)
        self.assertNotIn("runningApps.replaceChildren()", surface)
        self.assertNotIn("areaSwitcher.replaceChildren()", surface)

    def test_connected_interactive_nodes_are_never_reinserted(self):
        surface = self.read_surface()
        self.assertIn("function placeChildAt", surface)
        self.assertIn("if (child.parentElement === container) return;", surface)
        self.assertIn("container.insertBefore(child, current)", surface)
        self.assertIn("placeChildAt(windowLayer, windowNode, renderedIndex)", surface)
        self.assertIn("placeChildAt(body, section, index)", surface)
        self.assertIn("placeChildAt(appLauncher, button, index)", surface)
        self.assertIn("placeChildAt(runningApps, button, index)", surface)
        self.assertIn("placeChildAt(areaSwitcher, button, index)", surface)

    def test_focus_stack_is_visual_instead_of_dom_reordering(self):
        surface = self.read_surface()
        css = SURFACE_CSS.read_text(encoding="utf-8")
        self.assertIn(
            "windowNode.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized)",
            surface,
        )
        self.assertIn('.ordax-window[data-active="true"]', css)
        active_rule = css.split('.ordax-window[data-active="true"]', 1)[1].split("}", 1)[0]
        self.assertIn("z-index:", active_rule)

    def test_windows_are_reconciled_by_workspace_and_window_identity(self):
        surface = self.read_surface()
        self.assertIn("function syncWindowNode", surface)
        self.assertIn("windowNode.dataset.windowAreaId = area.id", surface)
        self.assertIn("windowNode.dataset.windowId = windowState.id", surface)
        self.assertIn("node.dataset.windowAreaId === area.id", surface)
        self.assertIn("node.dataset.windowId === windowState.id", surface)
        self.assertIn("node.dataset.appId === app.id", surface)
        self.assertIn("if (!retained.has(staleWindow)) staleWindow.remove();", surface)

    def test_area_control_selector_is_not_reused_by_window_identity(self):
        surface = self.read_surface()
        self.assertIn('event.target.closest("[data-area-id]")', surface)
        self.assertIn("button.dataset.areaId = area.id", surface)
        self.assertNotIn("windowNode.dataset.areaId", surface)
        self.assertNotIn("node.dataset.areaId === areaId", surface)
        self.assertNotIn("node.dataset.areaId === area.id", surface)
        self.assertIn("windowNode.dataset.windowAreaId = area.id", surface)

    def test_minimize_does_not_destroy_application_dom(self):
        surface = self.read_surface()
        self.assertIn("windowNode.hidden = windowState.minimized", surface)
        self.assertIn("windowNode.dataset.minimized = String(windowState.minimized)", surface)
        self.assertNotIn("if (windowState.minimized) continue;", surface)
        self.assertIn('if (action === "minimize" || action === "close")', surface)
        self.assertIn("workspace.focus({ preventScroll: true });", surface)

    def test_extension_slots_survive_shell_reconciliation(self):
        surface = self.read_surface()
        self.assertIn("function panelKey", surface)
        self.assertIn("function syncWindowPanels", surface)
        self.assertIn('return `extension:${panel.extensionId}`', surface)
        self.assertIn('if (panel.kind === "extension") {', surface)
        self.assertIn("section.dataset.appExtension = panel.extensionId", surface)
        self.assertIn("placeChildAt(body, section, index)", surface)

    def test_launcher_dock_and_area_controls_keep_stable_nodes(self):
        surface = self.read_surface()
        self.assertIn("button.hidden = !matches", surface)
        self.assertIn(
            "const focusedLauncherApp = root.ownerDocument.activeElement?.dataset?.launchApp ?? null",
            surface,
        )
        self.assertIn("focusedButton.hidden || focusedButton.disabled", surface)
        self.assertIn('child.dataset?.openWindow === windowState.id', surface)
        self.assertIn('child.dataset?.areaId === area.id', surface)
        self.assertIn('button:not(:disabled):not([hidden])', surface)


if __name__ == "__main__":
    unittest.main()
