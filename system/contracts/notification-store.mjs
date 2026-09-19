import {
  validateNotificationEntries,
  validateNotificationPolicy,
} from "./notifications.mjs";

export const NOTIFICATION_STORE_SCHEMA = "ordax.notification-store/3";

const STORE_SCOPES = new Set(["device", "session"]);
const DEFAULT_POLICY = Object.freeze({
  doNotDisturb: false,
  disabledSources: Object.freeze([]),
});

export function assertNotificationStore(store) {
  if (!store || typeof store !== "object" || store.schema !== NOTIFICATION_STORE_SCHEMA) {
    throw new TypeError("A compatible notification-store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Notification-store scope must be device or session");
  }
  for (const method of ["load", "save", "loadPolicy", "savePolicy"]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`Notification-store must implement ${method}()`);
    }
  }
  return store;
}

export function validateNotificationStorePayload(value) {
  if (value === null || value === undefined) return Object.freeze([]);
  return validateNotificationEntries(value);
}

export function validateNotificationPolicyPayload(value) {
  if (value === null || value === undefined) return DEFAULT_POLICY;
  return validateNotificationPolicy(value);
}
