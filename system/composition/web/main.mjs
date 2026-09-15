import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";

const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const host = createWebSurfaceHost(window);
const preferenceStore = createWebPreferenceStore(window);
const identitySession = createWebIdentitySession();
validateAccountRuntime(host.getSnapshot(), identitySession.getSnapshot());
const surface = mountSurface(root, host, preferenceStore, identitySession);

window.addEventListener(
  "pagehide",
  () => {
    surface.destroy();
    identitySession.dispose();
    host.dispose();
  },
  { once: true },
);
