export const SYNC_STATE_STORE_SCHEMA = "ordax.sync-state-store/1";
export const MAX_SYNC_STATE_PAYLOAD_BYTES = 65536;

export function validateSyncStatePayload(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError("Sync state payload must be a string or null");
  }
  if (new TextEncoder().encode(value).byteLength > MAX_SYNC_STATE_PAYLOAD_BYTES) {
    throw new TypeError("Sync state payload exceeds maximum size");
  }
  return value;
}

export function assertSyncStateStore(store) {
  if (!store || typeof store !== "object" || store.schema !== SYNC_STATE_STORE_SCHEMA) {
    throw new TypeError("A compatible sync-state-store is required");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Sync-state-store must implement load() and save()");
  }
  validateSyncStatePayload(store.load());
  return store;
}
