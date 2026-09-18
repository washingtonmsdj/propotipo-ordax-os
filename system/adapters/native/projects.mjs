import {
  PROJECT_STORE_SCHEMA,
  assertProjectStore,
  createEmptyProjectStoreState,
  validateProjectStoreState,
} from "../../contracts/project-store.mjs";

const STORAGE_KEY = "ordax.native.projects.v1";
const RECORD_SCHEMA = "ordax.native.projects-record/1";

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

export function createNativeProjectStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = createEmptyProjectStoreState();

  const store = {
    schema: PROJECT_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = createEmptyProjectStoreState();
          return memory;
        }
        memory = validateProjectStoreState(record.state);
      } catch {
        memory = createEmptyProjectStoreState();
      }
      return memory;
    },
    save(state) {
      memory = validateProjectStoreState(state);
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

  assertProjectStore(store);
  return Object.freeze(store);
}
