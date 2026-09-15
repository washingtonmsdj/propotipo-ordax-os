import {
  IDENTITY_ACTIONS_SCHEMA,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";

export function createWebIdentityActions() {
  const snapshot = validateIdentityActionsSnapshot({ supportedActions: [] });
  const listeners = new Set();

  return Object.freeze({
    schema: IDENTITY_ACTIONS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Identity actions listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async execute(action) {
      throw new Error(`Identity action is unavailable in the current Web adapter: ${String(action)}`);
    },
    dispose() {
      listeners.clear();
    },
  });
}
