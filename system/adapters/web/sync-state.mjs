import {
  SYNC_STATE_STORE_SCHEMA,
  assertSyncStateStore,
  validateSyncStatePayload,
} from "../../contracts/sync-state-store.mjs";

const STORAGE_KEY = "ordax.sync-state.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Browser policy may deny storage. Session memory remains valid.
  }
  return null;
}

export function createWebSyncStateStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = null;

  const store = {
    schema: SYNC_STATE_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        memory = validateSyncStatePayload(storage.getItem(STORAGE_KEY));
      } catch {
        // Corrupt/unavailable storage must not destroy the last good session payload.
      }
      return memory;
    },
    save(payload) {
      const validated = validateSyncStatePayload(payload);
      memory = validated;
      if (!storage) return false;
      try {
        if (validated === null) {
          storage.removeItem?.(STORAGE_KEY);
        } else {
          storage.setItem(STORAGE_KEY, validated);
        }
        return true;
      } catch {
        return false;
      }
    },
  };

  assertSyncStateStore(store);
  return Object.freeze(store);
}
