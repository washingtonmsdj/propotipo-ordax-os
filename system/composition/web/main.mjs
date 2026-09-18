import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { createWebWorkspaceStore } from "../../adapters/web/workspace.mjs";
import { createWebSyncStateStore } from "../../adapters/web/sync-state.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";

const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const host = createWebSurfaceHost(window);
const preferenceStore = createWebPreferenceStore(window);
const workspaceStore = createWebWorkspaceStore(window);
const syncStateStore = createWebSyncStateStore(window);
const identitySession = createWebIdentitySession();
const identityActions = createWebIdentityActions();
const appActivation = createAppActivationChannel();
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
);
const settingsOverviewControls = mountSettingsOverviewControls(
  root,
  host,
  surface.preferences,
  surface,
);
const systemOverviewControls = mountSystemOverviewControls(
  root,
  host,
  null,
  null,
  surface,
);

window.addEventListener(
  "pagehide",
  () => {
    systemOverviewControls.destroy();
    settingsOverviewControls.destroy();
    accountOverviewControls.destroy();
    preferenceSync.destroy();
    surface.destroy();
    identityActions.dispose();
    identitySession.dispose();
    host.dispose();
  },
  { once: true },
);
