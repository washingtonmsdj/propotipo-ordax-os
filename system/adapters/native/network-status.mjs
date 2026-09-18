import {
  NETWORK_STATUS_SCHEMA,
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";

const NETWORK_STATUS_ENDPOINT = "/__ordax/native/network-status";

export async function createNativeNetworkStatus(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native network-status adapter requires window.fetch");
  }

  const port = {
    schema: NETWORK_STATUS_SCHEMA,
    async read() {
      const response = await windowRef.fetch(NETWORK_STATUS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native network-status request failed: ${response.status}`);
      }
      return validateNetworkStatusSnapshot(await response.json());
    },
  };

  assertNetworkStatusPort(port);
  await port.read();
  return Object.freeze(port);
}
