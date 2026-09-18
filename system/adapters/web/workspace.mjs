import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  migrateLegacyWorkspaceRecord,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const STORAGE_KEY = "ordax.workspace.v2";
const LEGACY_STORAGE_KEY = "ordax.workspace.v1";

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

function readStored(storage, key, validator) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return validator(JSON.parse(raw));
}

export function createWebWorkspaceStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = validateWorkspaceRecord(null);

  const load = () => {
    if (!storage) return memory;
    const currentRaw = storage.getItem(STORAGE_KEY);
    if (currentRaw !== null) {
      try {
        memory = validateWorkspaceRecord(JSON.parse(currentRaw));
      } catch {
        memory = validateWorkspaceRecord(null);
      }
      return memory;
    }

    try {
      const legacy = readStored(storage, LEGACY_STORAGE_KEY, migrateLegacyWorkspaceRecord);
      if (legacy) {
        memory = legacy;
        storage.setItem(STORAGE_KEY, JSON.stringify(memory));
      }
    } catch {
      memory = validateWorkspaceRecord(null);
    }
    return memory;
  };

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load,
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
