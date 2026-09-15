import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

export function createWebSurfaceHost(windowRef = globalThis.window) {
  if (!windowRef?.navigator) {
    throw new TypeError("Web Surface host requires a browser-like window");
  }

  const listeners = new Set();
  const readSnapshot = () =>
    validateSurfaceSnapshot({
      capabilityIds: ["network.https"],
      connectivity: windowRef.navigator.onLine ? "online" : "offline",
    });

  const notify = () => {
    const snapshot = readSnapshot();
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };

  windowRef.addEventListener("online", notify);
  windowRef.addEventListener("offline", notify);

  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot: readSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface host listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      windowRef.removeEventListener("online", notify);
      windowRef.removeEventListener("offline", notify);
    },
  });
}
