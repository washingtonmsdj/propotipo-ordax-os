import { assertDiagnosticExportPort } from "../../contracts/diagnostic-export.mjs";
import { exportDiagnosticDocument } from "./export.mjs";
import { createDiagnosticReviewDocument } from "./review.mjs";

export const DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA = "ordax.diagnostic-review-controller/1";
export const DIAGNOSTIC_REVIEW_CONTROLLER_RESULT_SCHEMA = "ordax.diagnostic-review-controller-result/1";

function result(status, fields = {}) {
  return Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_RESULT_SCHEMA,
    status,
    ...fields,
  });
}

export function createDiagnosticReviewController({
  host,
  updateStatus = null,
  systemMetrics = null,
  updateHistory = null,
  diagnosticJournal = null,
  diagnosticExport = null,
  updateMaxAgeSeconds = undefined,
  clock = () => new Date().toISOString(),
}) {
  if (typeof clock !== "function") {
    throw new TypeError("Diagnostic review controller clock must be a function");
  }
  const exportPort = diagnosticExport === null
    ? null
    : assertDiagnosticExportPort(diagnosticExport);

  let generation = 0;
  let preparedDocument = null;
  let exportInFlight = false;

  return Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA,

    async prepare() {
      const requestGeneration = ++generation;
      preparedDocument = null;
      const generatedAt = clock();
      const document = await createDiagnosticReviewDocument({
        generatedAt,
        host,
        updateStatus,
        systemMetrics,
        updateHistory,
        diagnosticJournal,
        ...(updateMaxAgeSeconds === undefined
          ? {}
          : { updateMaxAgeSeconds }),
      });

      if (requestGeneration !== generation) {
        return result("superseded");
      }

      preparedDocument = document;
      return result("ready", { document });
    },

    async exportPrepared() {
      if (exportInFlight) {
        return result("failed", { code: "export-in-progress" });
      }
      if (preparedDocument === null) {
        return result("failed", { code: "review-not-prepared" });
      }
      if (exportPort === null) {
        return result("failed", { code: "export-unavailable" });
      }

      const document = preparedDocument;
      exportInFlight = true;
      try {
        const exportResult = await exportDiagnosticDocument(document, exportPort);
        if (exportResult.status === "saved" && preparedDocument === document) {
          preparedDocument = null;
        }
        return result(exportResult.status, {
          ...(exportResult.code ? { code: exportResult.code } : {}),
        });
      } finally {
        exportInFlight = false;
      }
    },
  });
}
