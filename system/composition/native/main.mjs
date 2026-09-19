import {
  createNativeClientDiagnostics,
  renderedSourceSha,
} from "../../adapters/native/client-diagnostics.mjs";
import { createNativeBrowserSession } from "../../adapters/native/browser-session.mjs";
import { createNativeComponentStateStore } from "../../adapters/native/component-state.mjs";
import { createNativeBrowserFavoritesStore } from "../../adapters/native/browser-favorites.mjs";
import { createNativeBrowserHistoryStore } from "../../adapters/native/browser-history.mjs";
import { createNativeDiagnosticJournalStore } from "../../adapters/native/diagnostic-journal-store.mjs";
import { createNativeFileSpace } from "../../adapters/native/file-space.mjs";
import { createNativeRecentFilesStore } from "../../adapters/native/recent-files.mjs";
import { createNativeProjectStore } from "../../adapters/native/projects.mjs";
import { createNativeProjectWebReferenceStore } from "../../adapters/native/project-web-references.mjs";
import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";
import { createNativeNotificationStore } from "../../adapters/native/notifications.mjs";
import { createNativeNotesStore } from "../../adapters/native/notes.mjs";
import { createNativeNetworkStatus } from "../../adapters/native/network-status.mjs";
import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
import { createNativePowerStatus } from "../../adapters/native/power-status.mjs";
import { createNativePreferenceStore } from "../../adapters/native/preferences.mjs";
import { createNativeSurfaceHost } from "../../adapters/native/runtime.mjs";
import { createNativeSystemMetrics } from "../../adapters/native/system-metrics.mjs";
import { createNativeUpdateHistory } from "../../adapters/native/update-history.mjs";
import { createNativeUpdateWatcher } from "../../adapters/native/update-runtime.mjs";
import { createNativeWorkspaceStore } from "../../adapters/native/workspace.mjs";
import { createNativeSyncStateStore } from "../../adapters/native/sync-state.mjs";
import { createNativeSurfaceHeartbeat } from "../../adapters/native/surface-heartbeat.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { listSystemComponents } from "../../services/components/catalog.mjs";
import { createComponentManager } from "../../services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../../services/components/runtime-loader.mjs";
import { createRecentFilesRuntime } from "../../services/files/recent-files.mjs";
import { createProjectCatalogRuntime } from "../../services/files/projects.mjs";
import { createProjectWebReferenceRuntime } from "../../services/projects/web-references.mjs";
import { createProjectContinuityFileSpace } from "../../services/files/project-continuity-file-space.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createUpdateNotificationBridge } from "../../services/notifications/update-bridge.mjs";
import { createNotesRuntime } from "../../services/notes/runtime.mjs";
import { createDiagnosticJournalRuntime } from "../../services/diagnostics/runtime.mjs";
import { createUpdateDiagnosticRecorder } from "../../services/diagnostics/update-recorder.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountFileSpaceControls } from "../../surface/ui/file-space-controls.mjs";
import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";
import { mountNetworkTrayControls } from "../../surface/ui/network-tray-controls.mjs";
import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";
import { mountNotesWorkspaceControls } from "../../surface/ui/notes-workspace-controls.mjs";
import { mountBatteryQuickPanel } from "../../surface/ui/battery-quick-panel.mjs";
import { mountBatteryTrayControls } from "../../surface/ui/battery-tray-controls.mjs";
import { mountHomeContinuation } from "../../surface/ui/home-continuation.mjs";
import { mountHomePending } from "../../surface/ui/home-pending.mjs";
import { mountPowerControls } from "../../surface/ui/power-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountSystemTrayQuickPanels } from "../../surface/ui/system-tray-quick-panels.mjs";
import { mountUpdateControls } from "../../surface/ui/update-controls.mjs";

async function optionalNativeProbe(label, factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn(label, error);
    return null;
  }
}

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const browserSession = createNativeBrowserSession(window);
  const preferenceStorePromise = createNativePreferenceStore(window);
  const optionalPortsPromise = Promise.all([
    optionalNativeProbe(
      "OrdaX native client diagnostics unavailable",
      () => createNativeClientDiagnostics(window),
    ),
    optionalNativeProbe(
      "OrdaX native diagnostic journal persistence unavailable",
      () => createNativeDiagnosticJournalStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native update history unavailable",
      () => createNativeUpdateHistory(window),
    ),
    optionalNativeProbe(
      "OrdaX native sync state persistence unavailable",
      () => createNativeSyncStateStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native component state persistence unavailable",
      () => createNativeComponentStateStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native notes persistence unavailable",
      () => createNativeNotesStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native power actions unavailable",
      () => createNativePowerActions(window),
    ),
    optionalNativeProbe(
      "OrdaX native user file-space unavailable",
      () => createNativeFileSpace(window),
    ),
    optionalNativeProbe(
      "OrdaX native network status unavailable",
      () => createNativeNetworkStatus(window),
    ),
    optionalNativeProbe(
      "OrdaX native network management unavailable",
      () => createNativeNetworkManagement(window),
    ),
    optionalNativeProbe(
      "OrdaX native system metrics unavailable",
      () => createNativeSystemMetrics(window),
    ),
    optionalNativeProbe(
      "OrdaX native power status unavailable",
      () => createNativePowerStatus(window),
    ),
  ]);

  const preferenceStore = await preferenceStorePromise;
  const [
    clientDiagnostics,
    diagnosticJournalStore,
    updateHistory,
    syncStateStore,
    componentStateStore,
    notesStore,
    powerActions,
    fileSpace,
    networkStatus,
    networkManagement,
    systemMetrics,
    powerStatus,
  ] = await optionalPortsPromise;

  const componentManager = createComponentManager({
    manifests: listSystemComponents(),
    store: componentStateStore,
  });
  const localWorkspaceStore = createNativeWorkspaceStore(window);
  const recentFiles = fileSpace === null ? null : createRecentFilesRuntime({
    store: createNativeRecentFilesStore(window),
  });
  const projects = fileSpace === null ? null : createProjectCatalogRuntime({
    store: createNativeProjectStore(window),
  });
  const projectReferences = projects === null ? null : createProjectWebReferenceRuntime({
    store: createNativeProjectWebReferenceStore(window),
    projects,
  });
  const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
  const workspaceStore = workspaceMetadata.store;
  const identitySession = createWebIdentitySession();
  const identityActions = createWebIdentityActions();
  const appActivation = createAppActivationChannel();
  const notesRuntime = createNotesRuntime({ store: notesStore });
  const updateWatcher = createNativeUpdateWatcher(window);
  const notifications = createNotificationsRuntime({
    store: createNativeNotificationStore(window),
  });
  const updateNotificationBridge = createUpdateNotificationBridge(updateWatcher, notifications);
  const diagnosticJournal = await createDiagnosticJournalRuntime({
    store: diagnosticJournalStore,
  });
  const updateDiagnosticRecorder = createUpdateDiagnosticRecorder(
    updateWatcher,
    diagnosticJournal,
  );
  const reportClientDiagnostic = (stage, error) => {
    console.error(`OrdaX Surface diagnostic: ${stage}`, error);
    if (clientDiagnostics) {
      void clientDiagnostics.report(renderedSourceSha(window), stage, error);
    }
  };
  const onWindowError = (event) => {
    reportClientDiagnostic("window-error", event.error ?? new Error("window-error"));
  };
  const onUnhandledRejection = (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error("unhandled-rejection");
    reportClientDiagnostic("unhandled-rejection", reason);
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  const bootControlAvailable = Boolean(
    powerActions?.getSnapshot().supportedActions.length,
  );
  const userFileSpaceAvailable = fileSpace !== null;
  const systemMetricsAvailable = systemMetrics !== null;
  const powerStatusAvailable = powerStatus !== null;
  const networkStatusAvailable = networkStatus !== null;
  const networkManagementAvailable = networkManagement !== null;
  const browserWebContentAvailable = browserSession.getSnapshot().supported;
  const host = createNativeSurfaceHost(window, {
    bootControlAvailable,
    userFileSpaceAvailable,
    systemMetricsAvailable,
    powerStatusAvailable,
    networkStatusAvailable,
    networkManagementAvailable,
    browserWebContentAvailable,
  });

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
    { fileSpace, appActivation },
  );
  const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation);
  let quickPanelControls = null;
  try {
    quickPanelControls = mountSystemTrayQuickPanels(root);
  } catch (error) {
    reportClientDiagnostic("system-tray-quick-panels", error);
  }
  let networkQuickPanel = null;
  try {
    networkQuickPanel = mountNetworkQuickPanel(root, networkStatus, networkManagement);
  } catch (error) {
    reportClientDiagnostic("network-quick-panel", error);
  }
  let batteryTrayControls = null;
  if (powerStatus) {
    try {
      batteryTrayControls = mountBatteryTrayControls(root, powerStatus);
    } catch (error) {
      reportClientDiagnostic("battery-tray-status", error);
    }
  }
  let batteryQuickPanel = null;
  if (powerStatus) {
    try {
      batteryQuickPanel = mountBatteryQuickPanel(root, powerStatus);
    } catch (error) {
      reportClientDiagnostic("battery-quick-panel", error);
    }
  }
  let networkTrayControls = null;
  if (networkStatus) {
    try {
      networkTrayControls = mountNetworkTrayControls(root, networkStatus);
    } catch (error) {
      reportClientDiagnostic("network-tray-status", error);
    }
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
  const homeContinuation = mountHomeContinuation(root, { projects, recentFiles });
  const homePending = mountHomePending(root, { notifications, syncRuntime: preferenceSync });
  const filesOwnerSpace = fileSpace === null
    ? null
    : createProjectContinuityFileSpace(fileSpace, projects, {
        onContinuityError(error) {
          reportClientDiagnostic("files-project-continuity", error);
        },
      });
  const fileSpaceControls = mountFileSpaceControls(
    root,
    filesOwnerSpace,
    appActivation,
    surface,
    { recentFiles, projects },
  );
  let settingsOverviewControls;
  try {
    settingsOverviewControls = mountSettingsOverviewControls(
      root,
      host,
      surface.preferences,
      surface,
      networkStatus,
      networkManagement,
      appActivation,
      notifications,
    );
  } catch (error) {
    reportClientDiagnostic("settings-network-management", error);
    settingsOverviewControls = mountSettingsOverviewControls(
      root,
      host,
      surface.preferences,
      surface,
      networkStatus,
      null,
      appActivation,
      notifications,
    );
  }
  const systemOverviewControls = mountSystemOverviewControls(
    root,
    host,
    updateWatcher,
    systemMetrics,
    surface,
    updateHistory,
    appActivation,
    null,
    componentManager,
  );
  const updateControls = mountUpdateControls(root, updateWatcher, appActivation);
  const powerControls = mountPowerControls(root, powerActions);

  // Reaching this point proves that the shared Surface composition mounted.
  // Optional app runtimes load only after this acknowledgement so an app-level
  // import or mount failure cannot turn into a failed OrdaX cold boot.
  componentManager.setCurrentHealth("surface-shell", "healthy");
  void updateWatcher.markHealthy();
  const surfaceHeartbeat = createNativeSurfaceHeartbeat(window);

  const internetComponent = await loadOptionalComponentRuntime({
    componentId: "internet",
    importer: () => import("../../apps/internet/runtime.mjs"),
    componentManager,
    context: {
      root,
      browserSession,
      surfaceLifecycle: surface,
      projects,
      projectReferences,
      createFavoritesStore: () => createNativeBrowserFavoritesStore(window),
      createHistoryStore: () => createNativeBrowserHistoryStore(window),
      enableShortcuts: true,
      reportDiagnostic: reportClientDiagnostic,
    },
    onError(error) {
      reportClientDiagnostic("internet-runtime", error);
    },
  });

  window.addEventListener(
    "pagehide",
    () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      surfaceHeartbeat.dispose();
      homePending.dispose();
      homeContinuation.dispose();
      powerControls.destroy();
      updateControls.destroy();
      systemOverviewControls.destroy();
      settingsOverviewControls.destroy();
      networkTrayControls?.destroy();
      networkQuickPanel?.destroy();
      quickPanelControls?.destroy();
      notificationCenter.destroy();
      batteryTrayControls?.destroy();
      batteryQuickPanel?.destroy();
      fileSpaceControls.destroy();
      notesWorkspaceControls.destroy();
      internetComponent?.destroy();
      projectReferences?.destroy();
      accountOverviewControls.destroy();
      preferenceSync.destroy();
      browserSession.dispose();
      updateNotificationBridge.destroy();
      updateDiagnosticRecorder.dispose();
      updateWatcher.dispose();
      componentManager.destroy();
      surface.destroy();
      notesRuntime.destroy();
      identityActions.dispose();
      identitySession.dispose();
      host.dispose();
    },
    { once: true },
  );
}

start().catch((error) => {
  console.error("OrdaX native composition failed", error);
});
