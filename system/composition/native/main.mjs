import { createNativeFileSpace } from "../../adapters/native/file-space.mjs";
import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
import { createNativePreferenceStore } from "../../adapters/native/preferences.mjs";
import { createNativeSurfaceHost } from "../../adapters/native/runtime.mjs";
import { createNativeUpdateWatcher } from "../../adapters/native/update-runtime.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { mountFileSpaceControls } from "../../surface/ui/file-space-controls.mjs";
import { mountPowerControls } from "../../surface/ui/power-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { mountSystemStatusControls } from "../../surface/ui/system-status-controls.mjs";
import { mountUpdateControls } from "../../surface/ui/update-controls.mjs";

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const preferenceStore = await createNativePreferenceStore(window);
  const identitySession = createWebIdentitySession();
  const identityActions = createWebIdentityActions();
  const updateWatcher = createNativeUpdateWatcher(window);

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

  const bootControlAvailable = Boolean(
    powerActions?.getSnapshot().supportedActions.length,
  );
  const userFileSpaceAvailable = fileSpace !== null;
  const host = createNativeSurfaceHost(window, {
    bootControlAvailable,
    userFileSpaceAvailable,
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
    identitySession,
    identityActions,
  );
  const fileSpaceControls = mountFileSpaceControls(root, fileSpace);
  const systemStatusControls = mountSystemStatusControls(root, updateWatcher);
  const updateControls = mountUpdateControls(root, updateWatcher);
  const powerControls = mountPowerControls(root, powerActions);

  // Reaching this point proves that the shared Surface composition mounted.
  // The native supervisor uses this acknowledgement to keep or roll back
  // a live update without rebooting the notebook.
  void updateWatcher.markHealthy();

  window.addEventListener(
    "pagehide",
    () => {
      powerControls.destroy();
      updateControls.destroy();
      systemStatusControls.destroy();
      fileSpaceControls.destroy();
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
