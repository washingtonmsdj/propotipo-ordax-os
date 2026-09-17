import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const STORAGE_KEY = "ordax.workspace.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Browser privacy/security policy may deny storage access.
  }
  return null;
}

export function createWebWorkspaceStore(windowRef = globalThis.window) {
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
        // Corrupt storage never prevents the Surface from starting.
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
