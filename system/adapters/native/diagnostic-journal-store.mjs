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

export async function createNativeDiagnosticJournalStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native diagnostic journal store requires window.fetch");
  }

  const initialResponse = await windowRef.fetch(NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  requireSuccess(initialResponse, "load");
  const initialBody = await initialResponse.json();
  let memory = validateDiagnosticJournalPayload(initialBody?.payload ?? null);

  const store = {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: "device",
    load() {
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
