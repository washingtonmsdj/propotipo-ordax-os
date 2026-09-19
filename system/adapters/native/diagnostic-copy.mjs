import {
  DIAGNOSTIC_COPY_SCHEMA,
  assertDiagnosticCopyPort,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";

export function createNativeDiagnosticCopy(clipboard) {
  if (!clipboard || typeof clipboard !== "object" || typeof clipboard.writeText !== "function") {
    throw new TypeError("Native diagnostic copy requires clipboard.writeText");
  }

  const port = {
    schema: DIAGNOSTIC_COPY_SCHEMA,
    async copy(value) {
      const summary = validateDiagnosticSummary(value);
      await clipboard.writeText(summary.text);
      return Object.freeze({ status: "copied" });
    },
  };

  assertDiagnosticCopyPort(port);
  return Object.freeze(port);
}
