import {
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../contracts/notes-store.mjs";

const STORAGE_KEY = "ordax.notes.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Privacy policy may deny local storage. The adapter falls back to session memory.
  }
  return null;
}

export function createWebNotesStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = null;

  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        memory = validateNotesSnapshot(JSON.parse(raw));
      } catch {
        // Ignore a corrupt payload and preserve the last valid in-memory snapshot.
      }
      return memory;
    },
    save(snapshot) {
      const validated = validateNotesSnapshot(snapshot);
      memory = validated;
      if (!storage) return true;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
  };

  assertNotesStore(store);
  return Object.freeze(store);
}
