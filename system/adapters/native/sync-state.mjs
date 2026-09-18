import {
  SYNC_STATE_STORE_SCHEMA,
  assertSyncStateStore,
  validateSyncStatePayload,
} from "../../contracts/sync-state-store.mjs";

const SYNC_STATE_ENDPOINT = "/__ordax/native/sync-state";

export async function createNativeSyncStateStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native sync state store requires window.fetch");
  }

  let memory = null;
  try {
    const response = await windowRef.fetch(SYNC_STATE_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) {
      const payload = await response.json();
      memory = validateSyncStatePayload(payload?.payload ?? null);
    }
  } catch {
    // Sync continuity is optional for boot. Session memory remains usable.
  }

  let persistQueue = Promise.resolve();
  const persist = async (payload) => {
    const response = await windowRef.fetch(SYNC_STATE_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!response.ok) {
      throw new Error(`Native sync state persistence failed: ${response.status}`);
    }
  };

  const store = {
    schema: SYNC_STATE_STORE_SCHEMA,
    load() {
      return memory;
    },
    save(payload) {
      const validated = validateSyncStatePayload(payload);
      memory = validated;
      persistQueue = persistQueue
        .then(() => persist(validated))
        .catch(() => false);
      return true;
    },
  };

  assertSyncStateStore(store);
  return Object.freeze(store);
}
