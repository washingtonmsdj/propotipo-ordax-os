import {
  POWER_STATUS_SCHEMA,
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";

const POWER_STATUS_ENDPOINT = "/__ordax/native/power-status";

export async function createNativePowerStatus(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native power-status adapter requires window.fetch");
  }

  const port = {
    schema: POWER_STATUS_SCHEMA,
    async read() {
      const response = await windowRef.fetch(POWER_STATUS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native power-status request failed: ${response.status}`);
      }
      return validatePowerStatusSnapshot(await response.json());
    },
  };

  assertPowerStatusPort(port);
  await port.read();
  return Object.freeze(port);
}
