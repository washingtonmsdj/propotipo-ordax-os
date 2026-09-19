import {
  PROJECT_WEB_REFERENCE_STORE_SCHEMA,
  assertProjectWebReferenceStore,
  createEmptyProjectWebReferenceStoreState,
  validateProjectWebReferenceStoreState,
} from "../../contracts/project-web-reference-store.mjs";

const STORAGE_KEY = "ordax.native.project-web-references.v1";
const RECORD_SCHEMA = "ordax.native.project-web-references-record/1";

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
    // Native profile storage may be unavailable; runtime then remains session-scoped.
  }
  return null;
}

export function createNativeProjectWebReferenceStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = createEmptyProjectWebReferenceStoreState();

  const store = {
    schema: PROJECT_WEB_REFERENCE_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = createEmptyProjectWebReferenceStoreState();
          return memory;
        }
        memory = validateProjectWebReferenceStoreState(record.state);
      } catch {
        memory = createEmptyProjectWebReferenceStoreState();
      }
      return memory;
    },
    save(state) {
      memory = validateProjectWebReferenceStoreState(state);
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

  assertProjectWebReferenceStore(store);
  return Object.freeze(store);
}
