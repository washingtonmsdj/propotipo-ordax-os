#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str, expected: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s), found {count}: {old!r}")
    file_path.write_text(text.replace(old, new), encoding="utf-8")


# Web composition: session-scoped notifications, mounted before the generic
# quick-panel controller so the controller sees the dynamically-owned panel.
patch(
    "system/composition/web/main.mjs",
    'import { createAppActivationChannel } from "../../services/apps/activation.mjs";\n',
    'import { createAppActivationChannel } from "../../services/apps/activation.mjs";\n'
    'import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";\n',
)
patch(
    "system/composition/web/main.mjs",
    'import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";\n',
    'import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";\n'
    'import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";\n',
)
patch(
    "system/composition/web/main.mjs",
    "const appActivation = createAppActivationChannel();\n",
    "const appActivation = createAppActivationChannel();\nconst notifications = createNotificationsRuntime();\n",
)
patch(
    "system/composition/web/main.mjs",
    "  appActivation,\n);\nlet quickPanelControls = null;\n",
    "  appActivation,\n);\nconst notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\nlet quickPanelControls = null;\n",
)
patch(
    "system/composition/web/main.mjs",
    "    networkQuickPanel?.destroy();\n    quickPanelControls?.destroy();\n",
    "    networkQuickPanel?.destroy();\n    quickPanelControls?.destroy();\n    notificationCenter.destroy();\n",
)

# Native composition: durable local store + update event producer. No account,
# network, diagnostics or browser responsibility is duplicated here.
patch(
    "system/composition/native/main.mjs",
    'import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";\n',
    'import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";\n'
    'import { createNativeNotificationStore } from "../../adapters/native/notifications.mjs";\n',
)
patch(
    "system/composition/native/main.mjs",
    'import { createProjectCatalogRuntime } from "../../services/files/projects.mjs";\n',
    'import { createProjectCatalogRuntime } from "../../services/files/projects.mjs";\n'
    'import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";\n'
    'import { createUpdateNotificationBridge } from "../../services/notifications/update-bridge.mjs";\n',
)
patch(
    "system/composition/native/main.mjs",
    'import { mountNetworkTrayControls } from "../../surface/ui/network-tray-controls.mjs";\n',
    'import { mountNetworkTrayControls } from "../../surface/ui/network-tray-controls.mjs";\n'
    'import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";\n',
)
patch(
    "system/composition/native/main.mjs",
    "  const appActivation = createAppActivationChannel();\n  const updateWatcher = createNativeUpdateWatcher(window);\n",
    "  const appActivation = createAppActivationChannel();\n  const updateWatcher = createNativeUpdateWatcher(window);\n"
    "  const notifications = createNotificationsRuntime({\n"
    "    store: createNativeNotificationStore(window),\n"
    "  });\n"
    "  const updateNotificationBridge = createUpdateNotificationBridge(updateWatcher, notifications);\n",
)
patch(
    "system/composition/native/main.mjs",
    "    appActivation,\n  );\n  let quickPanelControls = null;\n",
    "    appActivation,\n  );\n"
    "  const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\n"
    "  let quickPanelControls = null;\n",
)
patch(
    "system/composition/native/main.mjs",
    "      networkQuickPanel?.destroy();\n      quickPanelControls?.destroy();\n",
    "      networkQuickPanel?.destroy();\n      quickPanelControls?.destroy();\n      notificationCenter.destroy();\n",
)
patch(
    "system/composition/native/main.mjs",
    "      preferenceSync.destroy();\n      updateDiagnosticRecorder.dispose();\n",
    "      preferenceSync.destroy();\n      updateNotificationBridge.destroy();\n      updateDiagnosticRecorder.dispose();\n",
)

# Notification-specific styling uses the existing semantic tokens and existing
# quick-panel layout; no second shell layout is introduced.
notification_css = r'''
.ordax-tray-notifications {
  position: relative;
}

.ordax-notification-bell svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.ordax-notification-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border: 2px solid var(--ordax-surface-strong);
  border-radius: 999px;
  background: var(--ordax-accent);
  color: var(--ordax-accent-ink);
  font-size: 0.55rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  line-height: 11px;
  text-align: center;
}

.ordax-tray-notifications[data-unread="true"] {
  color: var(--ordax-accent);
}

.ordax-quick-panel-notifications {
  width: min(380px, calc(100vw - 36px));
}

.ordax-notification-list {
  display: grid;
  gap: 8px;
}

.ordax-notification-entry {
  display: grid;
  gap: 7px;
  padding: 12px 13px;
  border: 1px solid var(--ordax-border-soft);
  border-left: 3px solid transparent;
  border-radius: var(--ordax-radius-md);
  background: var(--ordax-subtle-bg);
}

.ordax-notification-entry[data-read="false"] {
  border-left-color: var(--ordax-accent);
}

.ordax-notification-entry-header,
.ordax-notification-actions,
.ordax-notification-footer,
.ordax-notification-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ordax-notification-entry-header,
.ordax-notification-footer {
  justify-content: space-between;
}

.ordax-notification-source,
.ordax-notification-time,
.ordax-notification-persistence {
  color: var(--ordax-muted);
  font-size: 0.66rem;
}

.ordax-notification-source {
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ordax-notification-title {
  font-size: 0.82rem;
  line-height: 1.3;
}

.ordax-notification-message {
  margin: 0;
  color: var(--ordax-muted);
  font-size: 0.73rem;
  line-height: 1.45;
}

.ordax-notification-actions {
  flex-wrap: wrap;
}

.ordax-notification-action {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--ordax-border);
  border-radius: var(--ordax-radius-sm);
  background: transparent;
  color: var(--ordax-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.69rem;
}

.ordax-notification-action:hover:not(:disabled),
.ordax-notification-action:focus-visible:not(:disabled) {
  background: var(--ordax-hover-bg);
  outline: 2px solid var(--ordax-focus);
  outline-offset: 1px;
}

.ordax-notification-action:disabled {
  opacity: 0.5;
  cursor: default;
}

.ordax-notification-footer {
  align-items: flex-start;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ordax-border-soft);
}

.ordax-notification-footer-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

'''
patch(
    "system/surface/ui/surface.css",
    ".ordax-area-button:hover:not(:disabled),\n",
    notification_css + ".ordax-area-button:hover:not(:disabled),\n",
)

# Materialize the exact CI ownership locally so the contract test can verify it.
# The temporary proof workflow restores this file before committing because the
# Actions token is intentionally not allowed to publish workflow changes.
workflow = ".github/workflows/surface-web-candidate.yml"
patch(
    workflow,
    "      - 'system/contracts/project-store.mjs'\n",
    "      - 'system/contracts/project-store.mjs'\n"
    "      - 'system/contracts/notifications.mjs'\n"
    "      - 'system/contracts/notification-store.mjs'\n",
    expected=2,
)
patch(
    workflow,
    "      - 'system/services/update/**'\n",
    "      - 'system/services/update/**'\n      - 'system/services/notifications/**'\n",
    expected=2,
)
patch(
    workflow,
    "      - 'tests/test_project_files_ui_contract.py'\n",
    "      - 'tests/test_project_files_ui_contract.py'\n"
    "      - 'tests/test_notifications.mjs'\n"
    "      - 'tests/test_notification_center_ui_contract.py'\n",
    expected=2,
)
patch(
    workflow,
    "            system/services/update \\\n",
    "            system/services/update \\\n            system/services/notifications \\\n",
)
patch(
    workflow,
    "          node --test tests/test_projects.mjs\n",
    "          node --test tests/test_projects.mjs\n          node --test tests/test_notifications.mjs\n",
)
patch(
    workflow,
    "          python -m unittest tests.test_project_files_ui_contract -v\n",
    "          python -m unittest tests.test_project_files_ui_contract -v\n"
    "          python -m unittest tests.test_notification_center_ui_contract -v\n",
)

print("NOTIFICATION_CENTER_MATERIALIZATION=PASS")
