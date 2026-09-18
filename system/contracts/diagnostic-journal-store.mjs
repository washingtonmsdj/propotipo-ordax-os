export const DIAGNOSTIC_JOURNAL_STORE_SCHEMA = "ordax.diagnostic-journal-store/1";
export const MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES = 4 * 1024 * 1024;

const STORE_SCOPES = new Set(["device", "session"]);

export function validateDiagnosticJournalPayload(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError("Diagnostic journal payload must be a string or null");
  }
  if (new TextEncoder().encode(value).byteLength > MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES) {
    throw new TypeError("Diagnostic journal payload exceeds maximum size");
  }
  return value;
}

export function assertDiagnosticJournalStore(store) {
  if (!store || typeof store !== "object") {
    throw new TypeError("Diagnostic journal store is required");
  }
  if (store.schema !== DIAGNOSTIC_JOURNAL_STORE_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic journal store schema: ${String(store.schema)}`);
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Diagnostic journal store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Diagnostic journal store must implement load() and save(payload)");
  }
  return store;
}
