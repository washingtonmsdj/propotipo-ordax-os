import {
  RECENT_FILES_STORE_SCHEMA,
  assertRecentFilesStore,
  validateRecentFilesStorePayload,
} from "../../contracts/recent-files-store.mjs";

const STORAGE_KEY = "ordax.native.recent-files.v1";
const RECORD_SCHEMA = "ordax.native.recent-files-record/1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage; the runtime remains session-scoped.
  }
  return null;
}

export function createNativeRecentFilesStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = Object.freeze([]);

  const store = {
    schema: RECENT_FILES_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = Object.freeze([]);
          return memory;
        }
        memory = validateRecentFilesStorePayload(record.entries);
      } catch {
        memory = Object.freeze([]);
      }
      return memory;
    },
    save(entries) {
      memory = validateRecentFilesStorePayload(entries);
      if (!storage) return false;
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ schema: RECORD_SCHEMA, entries: memory }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };

  assertRecentFilesStore(store);
  return Object.freeze(store);
}
