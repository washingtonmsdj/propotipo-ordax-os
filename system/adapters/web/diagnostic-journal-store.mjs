import {
  DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
  assertDiagnosticJournalStore,
  validateDiagnosticJournalPayload,
} from "../../contracts/diagnostic-journal-store.mjs";

export const WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY = "ordax.diagnostic-journal.v1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage
      && typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
      && typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Browser policy denied persistent storage. The adapter must report session scope.
  }
  return null;
}

export function createWebDiagnosticJournalStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let sessionPayload = null;

  const store = {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return sessionPayload;
      return validateDiagnosticJournalPayload(storage.getItem(WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY));
    },
    save(payload) {
      const validated = validateDiagnosticJournalPayload(payload);
      if (!storage) {
        sessionPayload = validated;
        return true;
      }
      if (validated === null) {
        storage.removeItem(WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY);
      } else {
        storage.setItem(WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY, validated);
      }
      return true;
    },
  };

  assertDiagnosticJournalStore(store);
  return Object.freeze(store);
}
