import {
  DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
  assertDiagnosticJournalStore,
  validateDiagnosticJournalPayload,
} from "../../contracts/diagnostic-journal-store.mjs";

export const NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT = "/__ordax/native/diagnostic-journal";

function requireSuccess(response, operation) {
  if (!response?.ok) {
    throw new Error(`Native diagnostic journal ${operation} failed: ${response?.status ?? "unknown"}`);
  }
  return response;
}

export function createNativeDiagnosticJournalStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native diagnostic journal store requires window.fetch");
  }

  let memory = null;
  const store = {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: "device",
    async load() {
      const response = await windowRef.fetch(NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "load");
      const body = await response.json();
      memory = validateDiagnosticJournalPayload(body?.payload ?? null);
      return memory;
    },
    async save(payload) {
      const validated = validateDiagnosticJournalPayload(payload);
      const response = await windowRef.fetch(NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: validated }),
      });
      requireSuccess(response, "save");
      memory = validated;
      return true;
    },
  };

  assertDiagnosticJournalStore(store);
  return Object.freeze(store);
}
