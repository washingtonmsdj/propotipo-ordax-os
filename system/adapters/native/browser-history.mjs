import {
  BROWSER_HISTORY_STORE_SCHEMA,
  assertBrowserHistoryStore,
  createEmptyBrowserHistoryStoreState,
  validateBrowserHistoryStoreState,
} from "../../contracts/browser-history-store.mjs";

const STORAGE_KEY = "ordax.native.browser-history.v1";
const RECORD_SCHEMA = "ordax.native.browser-history-record/1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage
      && typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
    ) {
      return storage;
    }
  } catch {
    // The privileged profile can be unavailable; retain an honest session fallback.
  }
  return null;
}

export function createNativeBrowserHistoryStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = createEmptyBrowserHistoryStoreState();

  const store = {
    schema: BROWSER_HISTORY_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = createEmptyBrowserHistoryStoreState();
          return memory;
        }
        memory = validateBrowserHistoryStoreState(record.state);
      } catch {
        memory = createEmptyBrowserHistoryStoreState();
      }
      return memory;
    },
    save(state) {
      memory = validateBrowserHistoryStoreState(state);
      if (!storage) return false;
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ schema: RECORD_SCHEMA, state: memory }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };

  assertBrowserHistoryStore(store);
  return Object.freeze(store);
}
