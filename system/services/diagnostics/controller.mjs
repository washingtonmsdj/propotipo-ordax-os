import { assertDiagnosticExportPort } from "../../contracts/diagnostic-export.mjs";
import { exportDiagnosticDocument } from "./export.mjs";
import { createDiagnosticReviewDocument } from "./review.mjs";

export const DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA = "ordax.diagnostic-review-controller/1";
export const DIAGNOSTIC_REVIEW_CONTROLLER_RESULT_SCHEMA = "ordax.diagnostic-review-controller-result/1";
export const DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA = "ordax.diagnostic-review-controller-state/1";

function result(status, fields = {}) {
  return Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_RESULT_SCHEMA,
    status,
    ...fields,
  });
}

function actionResult(action, status, code = "") {
  return Object.freeze({ action, status, code });
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
  let phase = "idle";
  let lastResult = null;
  const listeners = new Set();

  const snapshot = () => Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
    phase,
    exportAvailable: exportPort !== null,
    document: preparedDocument,
    lastResult,
  });

  const publish = () => {
    const value = snapshot();
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        // Presentation subscribers must never break collection/export semantics.
      }
    }
  };

  const updateState = (nextPhase, nextResult = lastResult) => {
    phase = nextPhase;
    lastResult = nextResult;
    publish();
  };

  return Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA,

    getSnapshot() {
      return snapshot();
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Diagnostic review controller listener must be a function");
      }
      listeners.add(listener);
      try {
        listener(snapshot());
      } catch {
        // A subscriber failure is isolated from the controller.
      }
      return () => listeners.delete(listener);
    },

    async prepare() {
      const requestGeneration = ++generation;
      preparedDocument = null;
      updateState("preparing", null);

      try {
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
        updateState("ready", actionResult("prepare", "ready"));
        return result("ready", { document });
      } catch {
        if (requestGeneration !== generation) {
          return result("superseded");
        }
        preparedDocument = null;
        updateState(
          "idle",
          actionResult("prepare", "failed", "review-prepare-failed"),
        );
        return result("failed", { code: "review-prepare-failed" });
      }
    },

    async exportPrepared() {
      if (exportInFlight) {
        return result("failed", { code: "export-in-progress" });
      }
      if (preparedDocument === null) {
        const failure = actionResult("export", "failed", "review-not-prepared");
        updateState(phase, failure);
        return result("failed", { code: failure.code });
      }
      if (exportPort === null) {
        const failure = actionResult("export", "failed", "export-unavailable");
        updateState(phase, failure);
        return result("failed", { code: failure.code });
      }

      const document = preparedDocument;
      const exportGeneration = generation;
      exportInFlight = true;
      updateState("exporting", null);

      let exportResult;
      try {
        exportResult = await exportDiagnosticDocument(document, exportPort);
      } catch {
        exportResult = Object.freeze({ status: "failed", code: "export-failed" });
      }
      exportInFlight = false;

      if (exportResult.status === "saved" && preparedDocument === document) {
        preparedDocument = null;
      }

      if (generation === exportGeneration) {
        const nextPhase = preparedDocument === null ? "idle" : "ready";
        updateState(
          nextPhase,
          actionResult("export", exportResult.status, exportResult.code ?? ""),
        );
      }

      return result(exportResult.status, {
        ...(exportResult.code ? { code: exportResult.code } : {}),
      });
    },
  });
}
