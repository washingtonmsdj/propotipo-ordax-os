from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"


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

    def test_windows_are_reconciled_by_workspace_and_window_identity(self):
        surface = self.read_surface()
        self.assertIn("function syncWindowNode", surface)
        self.assertIn("windowNode.dataset.areaId = area.id", surface)
        self.assertIn("windowNode.dataset.windowId = windowState.id", surface)
        self.assertIn("node.dataset.areaId === area.id", surface)
        self.assertIn("node.dataset.windowId === windowState.id", surface)
        self.assertIn("node.dataset.appId === app.id", surface)
        self.assertIn("windowLayer.append(windowNode)", surface)
        self.assertIn("if (!retained.has(staleWindow)) staleWindow.remove();", surface)

    def test_minimize_does_not_destroy_application_dom(self):
        surface = self.read_surface()
        self.assertIn("windowNode.hidden = windowState.minimized", surface)
        self.assertIn("windowNode.dataset.minimized = String(windowState.minimized)", surface)
        self.assertNotIn("if (windowState.minimized) continue;", surface)

    def test_extension_slots_survive_shell_reconciliation(self):
        surface = self.read_surface()
        self.assertIn("function panelKey", surface)
        self.assertIn("function syncWindowPanels", surface)
        self.assertIn('return `extension:${panel.extensionId}`', surface)
        self.assertIn('if (panel.kind === "extension") {', surface)
        self.assertIn("section.dataset.appExtension = panel.extensionId", surface)
        self.assertIn("body.append(section)", surface)

    def test_launcher_dock_and_area_controls_keep_stable_nodes(self):
        surface = self.read_surface()
        self.assertIn("button.hidden = !matches", surface)
        self.assertIn("activeElement?.dataset?.launchApp && activeElement.hidden", surface)
        self.assertIn('child.dataset?.openWindow === windowState.id', surface)
        self.assertIn('child.dataset?.areaId === area.id', surface)
        self.assertIn('button:not(:disabled):not([hidden])', surface)


if __name__ == "__main__":
    unittest.main()
