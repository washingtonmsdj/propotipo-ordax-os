import {
  POWER_ACTIONS_SCHEMA,
  isPowerActionSupported,
  validatePowerActionsSnapshot,
} from "../../contracts/power-actions.mjs";

const SESSION_ENDPOINT = "/__ordax/native/session";
const POWER_ENDPOINT = "/__ordax/native/power";

export async function createNativePowerActions(windowObject) {
  if (!windowObject || typeof windowObject.fetch !== "function") {
    throw new TypeError("Native power adapter requires a window-like fetch implementation");
  }

  const sessionResponse = await windowObject.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!sessionResponse.ok) {
    throw new Error(`Native power session unavailable: ${sessionResponse.status}`);
  }

  const session = await sessionResponse.json();
  if (!session || typeof session.token !== "string" || session.token.length < 24) {
    throw new TypeError("Native power session token is invalid");
  }
  const snapshot = validatePowerActionsSnapshot({
    supportedActions: session.supportedActions,
  });
  const token = session.token;

  return Object.freeze({
    schema: POWER_ACTIONS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Power actions subscriber must be a function");
      }
      return () => {};
    },
    async execute(action) {
      if (!isPowerActionSupported(snapshot, action)) {
        throw new TypeError(`Power action is unavailable: ${String(action)}`);
      }
      const response = await windowObject.fetch(POWER_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-OrdaX-Power-Token": token,
        },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(`Native power action failed: ${response.status}`);
      }
    },
  });
}
