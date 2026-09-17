import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const STORAGE_KEY = "ordax.native.workspace.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage access; memory remains usable.
  }
  return null;
}

export function createNativeWorkspaceStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = validateWorkspaceRecord(null);

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        memory = validateWorkspaceRecord(JSON.parse(raw));
      } catch {
        // Corrupt or inaccessible browser state never blocks the Surface.
      }
      return memory;
    },
    save(snapshot) {
      const validated = validateWorkspaceRecord(snapshot);
      memory = validated;
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(validated));
        return true;
      } catch {
        return false;
      }
    },
  };

  assertWorkspaceStore(store);
  return Object.freeze(store);
}
