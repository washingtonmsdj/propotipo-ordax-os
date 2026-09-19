from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class NotificationCenterUiContractTest(unittest.TestCase):
    def test_contract_runtime_store_catalog_and_bridge_have_single_owners(self):
        contract = read("system/contracts/notifications.mjs")
        store_contract = read("system/contracts/notification-store.mjs")
        runtime = read("system/services/notifications/runtime.mjs")
        catalog = read("system/services/notifications/catalog.mjs")
        bridge = read("system/services/notifications/update-bridge.mjs")
        native_store = read("system/adapters/native/notifications.mjs")

        self.assertIn('NOTIFICATIONS_SCHEMA = "ordax.notifications/2"', contract)
        self.assertIn('NOTIFICATION_STORE_SCHEMA = "ordax.notification-store/3"', store_contract)
        self.assertIn("MAX_NOTIFICATIONS = 64", contract)
        self.assertIn("MAX_DISABLED_NOTIFICATION_SOURCES", contract)
        self.assertIn("validateAppActivation", contract)
        self.assertIn("validateNotificationPolicy", contract)
        self.assertIn("setDoNotDisturb", contract)
        self.assertIn("setSourceEnabled", contract)
        self.assertIn("createNotificationsRuntime", runtime)
        self.assertIn('persistence = "session"', runtime)
        self.assertIn('policyPersistence = "session"', runtime)
        self.assertIn("policy.disabledSources.includes(draft.sourceId)", runtime)
        self.assertIn('SYSTEM_UPDATES_NOTIFICATION_SOURCE_ID = "system-updates"', catalog)
        self.assertIn("createUpdateNotificationBridge", bridge)
        self.assertIn("SYSTEM_UPDATES_NOTIFICATION_SOURCE_ID", bridge)
        self.assertIn("if (notification) center.publish(notification)", bridge)
        self.assertNotIn("lastError", bridge)
        self.assertIn('STORAGE_KEY = "ordax.native.notifications.v1"', native_store)
        self.assertIn('POLICY_STORAGE_KEY = "ordax.native.notification-policy.v1"', native_store)
        self.assertIn('scope: storage ? "device" : "session"', native_store)

    def test_notification_center_owns_only_its_dynamic_tray_and_panel_markup(self):
        controls = read("system/surface/ui/notification-center-controls.mjs")
        shell = read("system/surface/ui/desktop-shell.mjs")
        css = read("system/surface/ui/surface.css")

        self.assertIn('requireHost(root, ".ordax-system-tray"', controls)
        self.assertIn('requireHost(root, "[data-quick-panel-layer]"', controls)
        self.assertIn('tray.dataset.quickPanelToggle = "notifications"', controls)
        self.assertIn('panel.dataset.quickPanel = "notifications"', controls)
        self.assertIn('doNotDisturb.dataset.notificationDoNotDisturb = ""', controls)
        self.assertIn("center.setDoNotDisturb(!snapshot.doNotDisturb)", controls)
        self.assertIn("const attentionVisible = unread > 0 && !snapshot.doNotDisturb", controls)
        self.assertIn("notificationSourceLabel", controls)
        self.assertIn('panel.addEventListener("ordax:quick-panel-open", onPanelOpen)', controls)
        self.assertIn("activation.publish(entry.destination)", controls)
        self.assertIn("textContent", controls)
        self.assertNotIn("innerHTML", controls)
        self.assertNotIn("data-notification-tray", shell)

        for selector in [
            ".ordax-tray-notifications",
            ".ordax-notification-badge",
            ".ordax-quick-panel-notifications",
            ".ordax-notification-entry",
            ".ordax-notification-footer",
        ]:
            self.assertIn(selector, css)

    def test_web_and_native_share_notification_runtime_with_settings_and_center(self):
        web = read("system/composition/web/main.mjs")
        native = read("system/composition/native/main.mjs")

        for source in [web, native]:
            self.assertIn("createNotificationsRuntime", source)
            self.assertIn("mountNotificationCenterControls", source)
            mount_index = source.index("mountNotificationCenterControls(")
            generic_index = source.index("mountSystemTrayQuickPanels(root)")
            self.assertLess(mount_index, generic_index)
            self.assertIn("notificationCenter.destroy()", source)
            self.assertIn("appActivation,\n", source)
            self.assertIn("notifications,", source)

        self.assertIn("createNativeNotificationStore", native)
        self.assertIn("createUpdateNotificationBridge", native)
        self.assertIn("updateNotificationBridge.destroy()", native)
        self.assertNotIn("createUpdateNotificationBridge", web)

    def test_surface_ci_owns_notification_sources_and_tests(self):
        workflow = read(".github/workflows/surface-web-candidate.yml")

        for path in [
            "system/contracts/notifications.mjs",
            "system/contracts/notification-store.mjs",
            "system/services/notifications/**",
            "tests/test_notifications.mjs",
            "tests/test_notification_center_ui_contract.py",
        ]:
            self.assertGreaterEqual(workflow.count(path), 2, path)

        self.assertIn("system/services/notifications", workflow)
        self.assertIn("node --test tests/test_notifications.mjs", workflow)
        self.assertIn(
            "python -m unittest tests.test_notification_center_ui_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
