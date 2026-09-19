import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebNotesStore } from "../../adapters/web/notes.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { createWebWorkspaceStore } from "../../adapters/web/workspace.mjs";
import { createWebSyncStateStore } from "../../adapters/web/sync-state.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createNotesRuntime } from "../../services/notes/runtime.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountBrowserWorkspaceControls } from "../../surface/ui/browser-workspace-controls.mjs";
import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";
import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";
import { mountNotesWorkspaceControls } from "../../surface/ui/notes-workspace-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountSystemTrayQuickPanels } from "../../surface/ui/system-tray-quick-panels.mjs";

const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const host = createWebSurfaceHost(window);
const preferenceStore = createWebPreferenceStore(window);
const localWorkspaceStore = createWebWorkspaceStore(window);
const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
const workspaceStore = workspaceMetadata.store;
const syncStateStore = createWebSyncStateStore(window);
const identitySession = createWebIdentitySession();
const identityActions = createWebIdentityActions();
const appActivation = createAppActivationChannel();
const notifications = createNotificationsRuntime();
const notesRuntime = createNotesRuntime({ store: createWebNotesStore(window) });
validateAccountRuntime(
  host.getSnapshot(),
  identitySession.getSnapshot(),
  identityActions.getSnapshot(),
);
const surface = mountSurface(
  root,
  host,
  preferenceStore,
  workspaceStore,
  appActivation,
);
const notesWorkspaceControls = mountNotesWorkspaceControls(
  root,
  notesRuntime,
  surface,
  { appActivation },
);
const browserWorkspaceControls = mountBrowserWorkspaceControls(root, surface);
const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);
let quickPanelControls = null;
let networkQuickPanel = null;
try {
  quickPanelControls = mountSystemTrayQuickPanels(root);
  networkQuickPanel = mountNetworkQuickPanel(root, null, null);
} catch (error) {
  console.warn("OrdaX quick panels unavailable", error);
}
let syncMutationOrdinal = 0;
const preferenceSync = createPreferenceSyncRuntime(surface.preferences, {
  syncStateStore,
  createIdempotencyKey() {
    syncMutationOrdinal += 1;
    const uuid = window.crypto?.randomUUID?.();
    return `pref:${uuid ? uuid.replaceAll("-", "") : `${Date.now().toString(36)}:${syncMutationOrdinal}`}`;
  },
});
const accountOverviewControls = mountAccountOverviewControls(
  root,
  identitySession,
  identityActions,
  surface,
  preferenceSync,
  workspaceMetadata.source,
  appActivation,
);
const settingsOverviewControls = mountSettingsOverviewControls(
  root,
  host,
  surface.preferences,
  surface,
  null,
  null,
  appActivation,
  notifications,
);
const systemOverviewControls = mountSystemOverviewControls(
  root,
  host,
  null,
  null,
  surface,
  null,
  appActivation,
);

window.addEventListener(
  "pagehide",
  () => {
    systemOverviewControls.destroy();
    browserWorkspaceControls.destroy();
    notesWorkspaceControls.destroy();
    networkQuickPanel?.destroy();
    quickPanelControls?.destroy();
    notificationCenter.destroy();
    settingsOverviewControls.destroy();
    accountOverviewControls.destroy();
    preferenceSync.destroy();
    surface.destroy();
    notesRuntime.destroy();
    identityActions.dispose();
    identitySession.dispose();
    host.dispose();
  },
  { once: true },
);
