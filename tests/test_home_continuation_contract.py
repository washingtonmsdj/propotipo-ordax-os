from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / "system" / "surface" / "ui" / "home-continuation.mjs"
HOME_PENDING = ROOT / "system" / "surface" / "ui" / "home-pending.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class HomeContinuationContractTests(unittest.TestCase):
    def source(self):
        return HOME.read_text(encoding="utf-8")

    def pending_source(self):
        return HOME_PENDING.read_text(encoding="utf-8")

    def test_home_consumes_existing_owners_without_becoming_another_store(self):
        source = self.source()
        self.assertIn("assertProjectCatalogPort", source)
        self.assertIn("assertRecentFilesPort", source)
        self.assertIn("projectPort?.getSnapshot()", source)
        self.assertIn("recentPort?.getSnapshot()", source)
        self.assertIn("projectPort?.subscribe", source)
        self.assertIn("recentPort?.subscribe", source)
        self.assertNotIn("projectPort.create", source)
        self.assertNotIn("projectPort.recordOpened", source)
        self.assertNotIn("recentPort.recordOpened", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("fetch(", source)

    def test_home_routes_back_to_files_and_does_not_claim_to_open_recent_file(self):
        source = self.source()
        self.assertIn('appId: "files"', source)
        self.assertIn("target: project.path", source)
        self.assertIn("target: folder", source)
        self.assertIn("Mostrar ${entry.name} em Arquivos", source)
        self.assertNotIn("Abrir arquivo recente", source)
        self.assertNotIn("openFile", source)

    def test_home_uses_safe_dom_and_disappears_when_there_is_no_context(self):
        source = self.source()
        self.assertIn("createElement", source)
        self.assertIn("textContent", source)
        self.assertIn("section?.remove()", source)
        self.assertNotIn("innerHTML", source)
        self.assertIn("Continuar trabalho", source)
        self.assertIn("data-home-continuation-key", source.replace("dataset.homeContinuationKey", "data-home-continuation-key"))

    def test_home_mount_is_disposable_and_unsubscribes_both_sources(self):
        source = self.source()
        self.assertIn("dispose()", source)
        self.assertIn("unsubscribeRecent?.()", source)
        self.assertIn("unsubscribeProjects?.()", source)
        self.assertIn("destroyed = true", source)

    def test_home_pending_consumes_existing_attention_owners_without_duplicate_update_state(self):
        source = self.pending_source()
        self.assertIn("assertNotificationsPort", source)
        self.assertIn("assertSyncRuntimePort", source)
        self.assertIn("notificationsPort?.getSnapshot()", source)
        self.assertIn("syncPort?.getSnapshot()", source)
        self.assertIn("notificationsPort?.subscribe", source)
        self.assertIn("syncPort?.subscribe", source)
        self.assertIn("unreadCount", source)
        self.assertIn("pendingMutationCount", source)
        self.assertNotIn("update-status", source)
        self.assertNotIn("assertUpdateStatusPort", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("sessionStorage", source)
        self.assertNotIn("fetch(", source)

    def test_home_pending_uses_real_quick_panel_and_account_sync_destinations(self):
        source = self.pending_source()
        self.assertIn('actionKind: "quick-panel"', source)
        self.assertIn('panel: "notifications"', source)
        self.assertIn("button.dataset.quickPanelToggle = item.panel", source)
        self.assertIn('appId: "account"', source)
        self.assertIn('target: "sync"', source)
        self.assertIn("button.dataset.launchApp = item.appId", source)
        self.assertIn("button.dataset.appTarget = item.target", source)
        self.assertNotIn("Atualização de base pendente", source)

    def test_home_pending_is_safe_disposable_and_absent_without_real_pending_state(self):
        source = self.pending_source()
        self.assertIn("createElement", source)
        self.assertIn("textContent", source)
        self.assertIn("section?.remove()", source)
        self.assertIn('"Pendências"', source)
        self.assertIn("unsubscribeSync?.()", source)
        self.assertIn("unsubscribeNotifications?.()", source)
        self.assertNotIn("innerHTML", source)

    def test_native_composition_mounts_home_after_surface_and_disposes_it(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('from "../../surface/ui/home-continuation.mjs"', composition)
        self.assertIn(
            "const homeContinuation = mountHomeContinuation(root, { projects, recentFiles });",
            composition,
        )
        self.assertIn("homeContinuation.dispose();", composition)
        self.assertLess(
            composition.index("const surface = mountSurface("),
            composition.index("const homeContinuation = mountHomeContinuation("),
        )
        self.assertLess(
            composition.index("homeContinuation.dispose();"),
            composition.index("surface.destroy();"),
        )

    def test_native_composition_mounts_pending_after_real_owners_and_disposes_before_sync(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('from "../../surface/ui/home-pending.mjs"', composition)
        self.assertIn(
            "const homePending = mountHomePending(root, { notifications, syncRuntime: preferenceSync });",
            composition,
        )
        self.assertIn("homePending.dispose();", composition)
        self.assertLess(
            composition.index("const notificationCenter = mountNotificationCenterControls("),
            composition.index("const homePending = mountHomePending("),
        )
        self.assertLess(
            composition.index("const preferenceSync = createPreferenceSyncRuntime("),
            composition.index("const homePending = mountHomePending("),
        )
        self.assertLess(
            composition.index("homeContinuation = mountHomeContinuation("),
            composition.index("homePending = mountHomePending("),
        )
        self.assertLess(
            composition.index("homePending.dispose();"),
            composition.index("preferenceSync.destroy();"),
        )

    def test_surface_candidate_owns_home_continuation_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("tests/test_home_continuation.mjs"), 3)
        self.assertGreaterEqual(workflow.count("tests/test_home_continuation_contract.py"), 2)
        self.assertIn("node --test tests/test_home_continuation.mjs", workflow)
        self.assertIn(
            "python -m unittest tests.test_home_continuation_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
