import {
  UPDATE_HISTORY_SCHEMA,
  assertUpdateHistoryPort,
  validateUpdateHistorySnapshot,
} from "../../contracts/update-history.mjs";

const UPDATE_HISTORY_ENDPOINT = "/__ordax/native/update-history";

export async function createNativeUpdateHistory(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native update history adapter requires window.fetch");
  }

  const port = {
    schema: UPDATE_HISTORY_SCHEMA,
    async list() {
      const response = await windowRef.fetch(UPDATE_HISTORY_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native update history request failed: ${response.status}`);
      }
      return validateUpdateHistorySnapshot(await response.json());
    },
  };

  assertUpdateHistoryPort(port);
  await port.list();
  return Object.freeze(port);
}
