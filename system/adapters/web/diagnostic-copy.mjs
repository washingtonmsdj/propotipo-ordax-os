import {
  DIAGNOSTIC_COPY_SCHEMA,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";

export function createWebDiagnosticCopy(clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard || typeof clipboard.writeText !== "function") {
    throw new TypeError("Web diagnostic copy requires clipboard.writeText");
  }

  return Object.freeze({
    schema: DIAGNOSTIC_COPY_SCHEMA,

    async copy(summary) {
      const value = validateDiagnosticSummary(summary);
      await clipboard.writeText(value.text);
      return Object.freeze({ status: "copied" });
    },
  });
}
