import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebNotesStore } from "../../adapters/web/notes.mjs";
import { createWebBrowserSession } from "../../adapters/web/browser-session.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { createWebWorkspaceStore } from "../../adapters/web/workspace.mjs";
import { createWebSyncStateStore } from "../../adapters/web/sync-state.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { listSystemComponents } from "../../apps/component-catalog.mjs";
import { createComponentManager } from "../../services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../../services/components/runtime-loader.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";
import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { createSurfaceBootScreen } from "../../surface/ui/boot-screen.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountSystemTrayQuickPanels } from "../../surface/ui/system-tray-quick-panels.mjs";

const bootScreen = createSurfaceBootScreen(document);

try {
  bootScreen.setStage("Carregando superfície…");
const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const host = createWebSurfaceHost(window);
const browserSession = createWebBrowserSession();
const preferenceStore = createWebPreferenceStore(window);
const localWorkspaceStore = createWebWorkspaceStore(window);
const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
const workspaceStore = workspaceMetadata.store;
const syncStateStore = createWebSyncStateStore(window);
const identitySession = createWebIdentitySession();
const identityActions = createWebIdentityActions();
const appActivation = createAppActivationChannel();
const componentManager = createComponentManager({
  manifests: listSystemComponents(),
});
const notifications = createNotificationsRuntime();
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
  null,
  componentManager,
);

componentManager.setCurrentHealth("surface-shell", "healthy");
bootScreen.setStage("Carregando aplicativos…");
const filesComponent = await loadOptionalComponentRuntime({
  componentId: "files",
  importer: () => import("../../apps/files/runtime.mjs"),
  componentManager,
  context: {
    root,
    fileSpace: null,
    appActivation,
    surfaceLifecycle: surface,
  },
  onError(error) {
    console.warn("OrdaX Files runtime unavailable", error);
  },
});
const notesComponent = await loadOptionalComponentRuntime({
  componentId: "notes",
  importer: () => import("../../apps/notes/runtime.mjs"),
  componentManager,
  context: {
    root,
    createStore: () => createWebNotesStore(window),
    surfaceLifecycle: surface,
    appActivation,
  },
  onError(error) {
    console.warn("OrdaX Notes runtime unavailable", error);
  },
});
const internetComponent = await loadOptionalComponentRuntime({
  componentId: "internet",
  importer: () => import("../../apps/internet/runtime.mjs"),
  componentManager,
  context: {
    root,
    browserSession,
    surfaceLifecycle: surface,
    enableShortcuts: false,
  },
  onError(error) {
    console.warn("OrdaX Internet runtime unavailable", error);
  },
});

bootScreen.ready();

window.addEventListener(
  "pagehide",
  () => {
    systemOverviewControls.destroy();
    filesComponent?.destroy();
    internetComponent?.destroy();
    notesComponent?.destroy();
    networkQuickPanel?.destroy();
    quickPanelControls?.destroy();
    notificationCenter.destroy();
    settingsOverviewControls.destroy();
    accountOverviewControls.destroy();
    preferenceSync.destroy();
    browserSession.dispose();
    componentManager.destroy();
    surface.destroy();
    identityActions.dispose();
    identitySession.dispose();
    host.dispose();
  },
  { once: true },
);

} catch (error) {
  bootScreen.fail("Não foi possível iniciar a interface");
  console.error("OrdaX web composition failed", error);
}
