import {
  BROWSER_FAVORITES_STORE_SCHEMA,
  assertBrowserFavoritesStore,
  createEmptyBrowserFavoritesStoreState,
  validateBrowserFavoritesStoreState,
} from "../../contracts/browser-favorites-store.mjs";

const STORAGE_KEY = "ordax.native.browser-favorites.v1";
const RECORD_SCHEMA = "ordax.native.browser-favorites-record/1";

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
    // Native privileged profile storage may be unavailable; keep the runtime session-scoped.
  }
  return null;
}

export function createNativeBrowserFavoritesStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = createEmptyBrowserFavoritesStoreState();

  const store = {
    schema: BROWSER_FAVORITES_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = createEmptyBrowserFavoritesStoreState();
          return memory;
        }
        memory = validateBrowserFavoritesStoreState(record.state);
      } catch {
        memory = createEmptyBrowserFavoritesStoreState();
      }
      return memory;
    },
    save(state) {
      memory = validateBrowserFavoritesStoreState(state);
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

  assertBrowserFavoritesStore(store);
  return Object.freeze(store);
}
