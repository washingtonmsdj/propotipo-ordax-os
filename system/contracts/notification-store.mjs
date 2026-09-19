import { validateNotificationEntries } from "./notifications.mjs";

export const NOTIFICATION_STORE_SCHEMA = "ordax.notification-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function assertNotificationStore(store) {
  if (!store || typeof store !== "object" || store.schema !== NOTIFICATION_STORE_SCHEMA) {
    throw new TypeError("A compatible notification-store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Notification-store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Notification-store must implement load() and save()");
  }
  return store;
}

export function validateNotificationStorePayload(value) {
  if (value === null || value === undefined) return Object.freeze([]);
  return validateNotificationEntries(value);
}
