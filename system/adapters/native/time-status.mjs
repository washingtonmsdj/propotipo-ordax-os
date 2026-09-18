import {
  TIME_STATUS_SCHEMA,
  assertTimeStatusPort,
  validateTimeStatusSnapshot,
} from "../../contracts/time-status.mjs";

const TIME_STATUS_ENDPOINT = "/__ordax/native/time-status";

export async function createNativeTimeStatus(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native time-status adapter requires window.fetch");
  }

  const port = {
    schema: TIME_STATUS_SCHEMA,
    async read() {
      const response = await windowRef.fetch(TIME_STATUS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native time-status request failed: ${response.status}`);
      }
      return validateTimeStatusSnapshot(await response.json());
    },
  };

  assertTimeStatusPort(port);
  await port.read();
  return Object.freeze(port);
}
