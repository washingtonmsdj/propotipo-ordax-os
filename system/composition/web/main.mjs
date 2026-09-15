import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";

const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const host = createWebSurfaceHost(window);
const surface = mountSurface(root, host);

window.addEventListener(
  "pagehide",
  () => {
    surface.destroy();
    host.dispose();
  },
  { once: true },
);
