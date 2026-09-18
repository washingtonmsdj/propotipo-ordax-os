import { createNativeFileSpace } from "../../adapters/native/file-space.mjs";
import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";
import { createNativeNetworkStatus } from "../../adapters/native/network-status.mjs";
import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
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
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountFileSpaceControls } from "../../surface/ui/file-space-controls.mjs";
import { mountPowerControls } from "../../surface/ui/power-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountUpdateControls } from "../../surface/ui/update-controls.mjs";

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const preferenceStore = await createNativePreferenceStore(window);
  const localWorkspaceStore = createNativeWorkspaceStore(window);
  const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
  const workspaceStore = workspaceMetadata.store;
  const identitySession = createWebIdentitySession();
  const identityActions = createWebIdentityActions();
  const appActivation = createAppActivationChannel();
  const updateWatcher = createNativeUpdateWatcher(window);
  let updateHistory = null;
  try {
    updateHistory = await createNativeUpdateHistory(window);
  } catch (error) {
    console.warn("OrdaX native update history unavailable", error);
  }

  let syncStateStore = null;
  try {
    syncStateStore = await createNativeSyncStateStore(window);
  } catch (error) {
    console.warn("OrdaX native sync state persistence unavailable", error);
  }


  let powerActions = null;
  try {
    powerActions = await createNativePowerActions(window);
  } catch (error) {
    console.warn("OrdaX native power actions unavailable", error);
  }

  let fileSpace = null;
  try {
    fileSpace = await createNativeFileSpace(window);
  } catch (error) {
    console.warn("OrdaX native user file-space unavailable", error);
  }

  let networkStatus = null;
  try {
    networkStatus = await createNativeNetworkStatus(window);
  } catch (error) {
    console.warn("OrdaX native network status unavailable", error);
  }

  let networkManagement = null;
  try {
    networkManagement = await createNativeNetworkManagement(window);
  } catch (error) {
    console.warn("OrdaX native network management unavailable", error);
  }

  let systemMetrics = null;
  try {
    systemMetrics = await createNativeSystemMetrics(window);
  } catch (error) {
    console.warn("OrdaX native system metrics unavailable", error);
  }

  const bootControlAvailable = Boolean(
    powerActions?.getSnapshot().supportedActions.length,
  );
  const userFileSpaceAvailable = fileSpace !== null;
  const systemMetricsAvailable = systemMetrics !== null;
  const networkStatusAvailable = networkStatus !== null;
  const networkManagementAvailable = networkManagement !== null;
  const host = createNativeSurfaceHost(window, {
    bootControlAvailable,
    userFileSpaceAvailable,
    systemMetricsAvailable,
    networkStatusAvailable,
    networkManagementAvailable,
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
    host,
    identitySession,
    identityActions,
    surface,
    preferenceSync,
    workspaceMetadata.source,
  );
  const fileSpaceControls = mountFileSpaceControls(root, fileSpace, appActivation, surface);
  const settingsOverviewControls = mountSettingsOverviewControls(
    root,
    host,
    surface.preferences,
    surface,
    networkStatus,
  );
  const systemOverviewControls = mountSystemOverviewControls(
    root,
    host,
    updateWatcher,
    systemMetrics,
    surface,
    updateHistory,
  );
  const updateControls = mountUpdateControls(root, updateWatcher);
  const powerControls = mountPowerControls(root, powerActions);

  // Reaching this point proves that the shared Surface composition mounted.
  // The native supervisor uses this acknowledgement to keep or roll back
  // a live update without rebooting the notebook.
  void updateWatcher.markHealthy();
  const surfaceHeartbeat = createNativeSurfaceHeartbeat(window);

  window.addEventListener(
    "pagehide",
    () => {
      surfaceHeartbeat.dispose();
      powerControls.destroy();
      updateControls.destroy();
      systemOverviewControls.destroy();
      settingsOverviewControls.destroy();
      fileSpaceControls.destroy();
      accountOverviewControls.destroy();
      preferenceSync.destroy();
      updateWatcher.dispose();
      surface.destroy();
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
