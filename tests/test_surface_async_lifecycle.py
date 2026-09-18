from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "system" / "surface" / "ui"


class SurfaceAsyncLifecycleTests(unittest.TestCase):
    def read(self, name):
        return (UI / name).read_text(encoding="utf-8")

    def test_account_discards_action_completion_after_destroy(self):
        controls = self.read("account-overview-controls.mjs")
        self.assertIn("let actionOrdinal = 0;", controls)
        self.assertIn("const ordinal = ++actionOrdinal;", controls)
        self.assertIn("if (destroyed || ordinal !== actionOrdinal) return;", controls)
        self.assertIn("actionOrdinal += 1;", controls)

    def test_settings_discards_stale_poll_and_action_results(self):
        controls = self.read("settings-overview-controls.mjs")
        for ordinal in (
            "networkReadOrdinal",
            "networkManagementReadOrdinal",
            "networkActionOrdinal",
        ):
            self.assertIn(f"let {ordinal} = 0;", controls)
            self.assertIn(f"{ordinal} += 1;", controls)
        self.assertIn("const ordinal = ++networkReadOrdinal;", controls)
        self.assertIn("const ordinal = ++networkManagementReadOrdinal;", controls)
        self.assertIn("const ordinal = ++networkActionOrdinal;", controls)
        self.assertIn("ordinal !== networkReadOrdinal", controls)
        self.assertIn("ordinal !== networkManagementReadOrdinal", controls)
        self.assertIn("ordinal !== networkActionOrdinal", controls)

    def test_quick_wifi_discards_stale_reads_and_actions(self):
        controls = self.read("network-quick-panel.mjs")
        for ordinal in ("statusOrdinal", "managementOrdinal", "actionOrdinal"):
            self.assertIn(f"let {ordinal} = 0;", controls)
            self.assertIn(f"{ordinal} += 1;", controls)
        self.assertIn("ordinal !== statusOrdinal", controls)
        self.assertIn("ordinal !== managementOrdinal", controls)
        self.assertIn("ordinal !== actionOrdinal", controls)

    def test_quick_wifi_preserves_transient_interaction_without_persisting_credentials(self):
        controls = self.read("network-quick-panel.mjs")
        controller = self.read("system-tray-quick-panels.mjs")
        self.assertIn('let passwordDraft = "";', controls)
        self.assertIn("captureInteraction", controls)
        self.assertIn("restoreInteraction", controls)
        self.assertIn("panelScrollTop", controls)
        self.assertIn("listScrollTop", controls)
        self.assertIn("passwordSelection", controls)
        self.assertIn('panel.addEventListener("input", onInput)', controls)
        self.assertIn('panel.addEventListener("ordax:quick-panel-close", onClose)', controls)
        self.assertIn('input.value = passwordDraftSsid === selected.ssid ? passwordDraft : "";', controls)
        self.assertIn("clearPasswordDraft()", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertIn('new CustomEvent("ordax:quick-panel-close"', controller)

    def test_quick_wifi_keeps_last_valid_observation_distinct_from_unavailable(self):
        controls = self.read("network-quick-panel.mjs")
        self.assertIn("let statusReadFailed = false;", controls)
        self.assertIn("let statusLastSuccessAt = null;", controls)
        self.assertIn("let managementReadFailed = false;", controls)
        self.assertIn("let managementLastSuccessAt = null;", controls)
        self.assertIn("statusReadFailed = true;", controls)
        self.assertIn("managementReadFailed = true;", controls)
        self.assertNotIn("statusSnapshot = null;\n    } catch", controls)
        self.assertIn("Redes exibidas com dados antigos", controls)
        self.assertIn("última leitura recebida pela Surface", controls)
        self.assertIn('summary.dataset.observation = statusReadFailed ? "stale" : "current"', controls)

    def test_read_only_tray_widgets_do_not_render_after_destroy(self):
        battery_quick = self.read("battery-quick-panel.mjs")
        battery_tray = self.read("battery-tray-controls.mjs")
        network_tray = self.read("network-tray-controls.mjs")
        self.assertIn("validatePowerStatusSnapshot(await port.read())", battery_quick)
        self.assertIn("if (destroyed) return;", battery_quick)
        self.assertIn("validatePowerStatusSnapshot(await port.read())", battery_tray)
        self.assertIn("if (destroyed) return;", battery_tray)
        self.assertIn("lastSnapshot", battery_quick)
        self.assertIn("lastSnapshot", battery_tray)
        self.assertIn("const snapshot = validateNetworkStatusSnapshot(await port.read());", network_tray)
        self.assertIn("if (destroyed) return;", network_tray)

    def test_power_action_completion_is_bound_to_live_controller(self):
        controls = self.read("power-controls.mjs")
        self.assertIn("let actionOrdinal = 0;", controls)
        self.assertIn("let destroyed = false;", controls)
        self.assertIn("const ordinal = ++actionOrdinal;", controls)
        self.assertGreaterEqual(
            controls.count("if (destroyed || ordinal !== actionOrdinal) return;"),
            3,
        )
        self.assertIn("actionOrdinal += 1;", controls)

    def test_files_preserves_focus_selection_and_scroll_across_repaints(self):
        files = self.read("file-space-controls.mjs")
        self.assertIn("captureInteractionState", files)
        self.assertIn("restoreInteractionState", files)
        self.assertIn("windowScrollTop", files)
        self.assertIn("listScrollTop", files)
        self.assertIn("previewScrollTop", files)
        self.assertIn("selectionStart", files)
        self.assertIn("selectionEnd", files)
        self.assertIn("preventScroll: true", files)
        self.assertIn('requestFocus("directory-name")', files)
        self.assertIn('requestFocus("rename-name", selected.path)', files)
        self.assertIn('requestFocus("copy-name", selected.path)', files)
        self.assertIn('requestFocus("search")', files)
        self.assertIn("snapshot.path === (listing?.path ?? \"\")", files)
        self.assertIn("slot.dataset.fileSpacePath = listing?.path ?? \"\"", files)
        self.assertNotIn("queueMicrotask(() => input.isConnected && input.focus())", files)

    def test_existing_file_and_system_async_owners_keep_ordinal_guards(self):
        files = self.read("file-space-controls.mjs")
        system = self.read("system-overview-controls.mjs")
        self.assertIn("requestOrdinal", files)
        self.assertIn("ordinal !== requestOrdinal", files)
        self.assertIn("metricsOrdinal", system)
        self.assertIn("ordinal !== metricsOrdinal", system)
        self.assertIn("historyOrdinal", system)
        self.assertIn("ordinal !== historyOrdinal", system)


if __name__ == "__main__":
    unittest.main()
