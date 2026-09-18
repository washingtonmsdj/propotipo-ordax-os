export const DIAGNOSTIC_EXPORT_SCHEMA = "ordax.diagnostic-export/1";
export const MAX_DIAGNOSTIC_EXPORT_TEXT_CHARS = 2_000_000;

const FILE_NAME_RE = /^[^/\\\u0000-\u001f\u007f]{1,160}\.json$/i;
const SAVE_STATUSES = new Set(["saved", "cancelled"]);

export function validateDiagnosticExportDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic export document must be an object");
  }
  if (typeof value.fileName !== "string" || !FILE_NAME_RE.test(value.fileName)) {
    throw new TypeError("Diagnostic export fileName must be a bounded JSON basename");
  }
  if (value.fileName === ".json" || value.fileName.includes("..")) {
    throw new TypeError("Diagnostic export fileName must not contain traversal segments");
  }
  if (value.mediaType !== "application/json") {
    throw new TypeError("Diagnostic export mediaType must be application/json");
  }
  if (
    typeof value.text !== "string"
    || value.text.length === 0
    || value.text.length > MAX_DIAGNOSTIC_EXPORT_TEXT_CHARS
  ) {
    throw new TypeError("Diagnostic export text must be non-empty and bounded");
  }

  return Object.freeze({
    fileName: value.fileName,
    mediaType: value.mediaType,
    text: value.text,
  });
}

export function validateDiagnosticExportSaveResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic export save result must be an object");
  }
  if (!SAVE_STATUSES.has(value.status)) {
    throw new TypeError(`Unsupported diagnostic export save status: ${String(value.status)}`);
  }
  return Object.freeze({ status: value.status });
}

export function assertDiagnosticExportPort(port) {
  if (!port || typeof port !== "object" || port.schema !== DIAGNOSTIC_EXPORT_SCHEMA) {
    throw new TypeError("A compatible diagnostic-export port is required");
  }
  if (typeof port.save !== "function") {
    throw new TypeError("Diagnostic-export port must implement save(document)");
  }
  return port;
}
