export const MAX_DIAGNOSTIC_TEXT = 1000;

export function redactDiagnosticText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new TypeError("Diagnostic text must be a string");
  }

  return value
    .slice(0, MAX_DIAGNOSTIC_TEXT)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|passwd|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, "[user-path]")
    .replace(/\/home\/[^/\s]+/g, "/home/[user]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
}
