import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";

const BASE_CAPABILITIES = Object.freeze([
  "surface.render",
  "network.https",
]);

export function createNativeSurfaceHost(
  windowRef = globalThis.window,
  {
    bootControlAvailable = false,
    userFileSpaceAvailable = false,
    systemMetricsAvailable = false,
    networkStatusAvailable = false,
  } = {},
) {
  if (!windowRef?.navigator) {
    throw new TypeError("Native Surface host requires a browser-like window");
  }

  const listeners = new Set();
  const readSnapshot = () => {
    const capabilityIds = [...BASE_CAPABILITIES];
    if (userFileSpaceAvailable) {
      capabilityIds.push("filesystem.user-space");
    }
    if (systemMetricsAvailable) {
      capabilityIds.push("system.metrics");
    }
    if (networkStatusAvailable) {
      capabilityIds.push("network.status");
    }
    if (bootControlAvailable) {
      capabilityIds.push("system.boot-control");
    }
    return validateSurfaceSnapshot({
      capabilityIds,
      connectivity: windowRef.navigator.onLine ? "online" : "offline",
    });
  };

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
