import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
import { createNativeUpdateWatcher } from "../../adapters/native/update-runtime.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { mountPowerControls } from "../../surface/ui/power-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const host = createWebSurfaceHost(window);
  const preferenceStore = createWebPreferenceStore(window);
  const identitySession = createWebIdentitySession();
  const identityActions = createWebIdentityActions();
  const updateWatcher = createNativeUpdateWatcher(window);
  let powerActions = null;
  try {
    powerActions = await createNativePowerActions(window);
  } catch (error) {
    console.warn("OrdaX native power actions unavailable", error);
  }

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
  const powerControls = mountPowerControls(root, powerActions);

  window.addEventListener(
    "pagehide",
    () => {
      updateWatcher.dispose();
      powerControls.destroy();
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
