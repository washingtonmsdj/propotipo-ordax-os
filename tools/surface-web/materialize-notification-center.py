#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "tools/surface-web/materialize-notification-center-base.py"
source = BASE.read_text(encoding="utf-8")


def rewrite(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"materializer reconciliation expected one source block, found {count}")
    source = source.replace(old, new)


rewrite(
'''patch(
    "system/composition/web/main.mjs",
    "  appActivation,\\n);\\nlet quickPanelControls = null;\\n",
    "  appActivation,\\n);\\nconst notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\\nlet quickPanelControls = null;\\n",
)''',
'''patch(
    "system/composition/web/main.mjs",
    "const notesWorkspaceControls = mountNotesWorkspaceControls(root, notesRuntime, surface);\\nlet quickPanelControls = null;\\n",
    "const notesWorkspaceControls = mountNotesWorkspaceControls(root, notesRuntime, surface);\\nconst notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\\nlet quickPanelControls = null;\\n",
)''',
)

rewrite(
'''patch(
    "system/composition/native/main.mjs",
    "  const appActivation = createAppActivationChannel();\\n  const updateWatcher = createNativeUpdateWatcher(window);\\n",
    "  const appActivation = createAppActivationChannel();\\n  const updateWatcher = createNativeUpdateWatcher(window);\\n"
    "  const notifications = createNotificationsRuntime({\\n"
    "    store: createNativeNotificationStore(window),\\n"
    "  });\\n"
    "  const updateNotificationBridge = createUpdateNotificationBridge(updateWatcher, notifications);\\n",
)''',
'''patch(
    "system/composition/native/main.mjs",
    "  const updateWatcher = createNativeUpdateWatcher(window);\\n  const diagnosticJournal = await createDiagnosticJournalRuntime({\\n",
    "  const updateWatcher = createNativeUpdateWatcher(window);\\n"
    "  const notifications = createNotificationsRuntime({\\n"
    "    store: createNativeNotificationStore(window),\\n"
    "  });\\n"
    "  const updateNotificationBridge = createUpdateNotificationBridge(updateWatcher, notifications);\\n"
    "  const diagnosticJournal = await createDiagnosticJournalRuntime({\\n",
)''',
)

rewrite(
'''patch(
    "system/composition/native/main.mjs",
    "    appActivation,\\n  );\\n  let quickPanelControls = null;\\n",
    "    appActivation,\\n  );\\n"
    "  const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\\n"
    "  let quickPanelControls = null;\\n",
)''',
'''patch(
    "system/composition/native/main.mjs",
    "    { fileSpace, appActivation },\\n  );\\n  let quickPanelControls = null;\\n",
    "    { fileSpace, appActivation },\\n  );\\n"
    "  const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);\\n"
    "  let quickPanelControls = null;\\n",
)''',
)

rewrite(
'''.ordax-notification-bell svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}
''',
'''.ordax-notification-bell-shape {
  position: relative;
  display: block;
  width: 14px;
  height: 13px;
  border: 1.7px solid currentColor;
  border-bottom: 0;
  border-radius: 8px 8px 3px 3px;
}

.ordax-notification-bell-shape::before {
  position: absolute;
  left: -3px;
  right: -3px;
  bottom: -3px;
  height: 1.7px;
  border-radius: 999px;
  background: currentColor;
  content: "";
}

.ordax-notification-bell-shape::after {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  content: "";
  transform: translateX(-50%);
}
''',
)

exec(compile(source, str(BASE), "exec"), {"__name__": "__main__", "__file__": str(BASE)})
