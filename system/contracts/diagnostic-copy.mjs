export const DIAGNOSTIC_COPY_SCHEMA = "ordax.diagnostic-copy/1";
export const DIAGNOSTIC_SUMMARY_SCHEMA = "ordax.diagnostic-summary/1";
export const MAX_DIAGNOSTIC_SUMMARY_TEXT_CHARS = 64_000;

const COPY_STATUSES = new Set(["copied"]);

export function validateDiagnosticSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic summary must be an object");
  }
  if (value.schema !== DIAGNOSTIC_SUMMARY_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic summary schema: ${String(value.schema)}`);
  }
  if (value.mediaType !== "text/plain;charset=utf-8") {
    throw new TypeError("Diagnostic summary mediaType must be text/plain;charset=utf-8");
  }
  if (
    typeof value.text !== "string"
    || value.text.length === 0
    || value.text.length > MAX_DIAGNOSTIC_SUMMARY_TEXT_CHARS
  ) {
    throw new TypeError("Diagnostic summary text must be non-empty and bounded");
  }

  return Object.freeze({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: value.mediaType,
    text: value.text,
  });
}

export function validateDiagnosticCopyResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic copy result must be an object");
  }
  if (!COPY_STATUSES.has(value.status)) {
    throw new TypeError(`Unsupported diagnostic copy status: ${String(value.status)}`);
  }
  return Object.freeze({ status: value.status });
}

export function assertDiagnosticCopyPort(port) {
  if (!port || typeof port !== "object" || port.schema !== DIAGNOSTIC_COPY_SCHEMA) {
    throw new TypeError("A compatible diagnostic-copy port is required");
  }
  if (typeof port.copy !== "function") {
    throw new TypeError("Diagnostic-copy port must implement copy(summary)");
  }
  return port;
}
