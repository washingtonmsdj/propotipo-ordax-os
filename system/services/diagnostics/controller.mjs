import { assertDiagnosticCopyPort } from "../../contracts/diagnostic-copy.mjs";
import { assertDiagnosticExportPort } from "../../contracts/diagnostic-export.mjs";
import { copyDiagnosticReviewSummary } from "./copy.mjs";
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
  diagnosticCopy = null,
  updateMaxAgeSeconds = undefined,
  clock = () => new Date().toISOString(),
}) {
  if (typeof clock !== "function") {
    throw new TypeError("Diagnostic review controller clock must be a function");
  }
  const exportPort = diagnosticExport === null
    ? null
    : assertDiagnosticExportPort(diagnosticExport);
  const copyPort = diagnosticCopy === null
    ? null
    : assertDiagnosticCopyPort(diagnosticCopy);

  let generation = 0;
  let preparedDocument = null;
  let outputInFlight = null;
  // phase describes this explicit review workflow only; it is not a device/service health verdict.
  let phase = "idle";
  let lastResult = null;
  const listeners = new Set();

  const snapshot = () => Object.freeze({
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
    phase,
    exportAvailable: exportPort !== null,
    copyAvailable: copyPort !== null,
    document: preparedDocument,
    lastResult,
  });

  const publish = () => {
    const value = snapshot();
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        // Presentation subscribers must never break collection/output semantics.
      }
    }
  };

  const updateState = (nextPhase, nextResult = lastResult) => {
    phase = nextPhase;
    lastResult = nextResult;
    publish();
  };

  const outputBusyCode = () => outputInFlight === "copy"
    ? "copy-in-progress"
    : "export-in-progress";

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

    async copyPreparedSummary() {
      if (outputInFlight !== null) {
        return result("failed", { code: outputBusyCode() });
      }
      if (preparedDocument === null) {
        const failure = actionResult("copy", "failed", "review-not-prepared");
        updateState(phase, failure);
        return result("failed", { code: failure.code });
      }
      if (copyPort === null) {
        const failure = actionResult("copy", "failed", "copy-unavailable");
        updateState(phase, failure);
        return result("failed", { code: failure.code });
      }

      const document = preparedDocument;
      const copyGeneration = generation;
      outputInFlight = "copy";
      updateState("copying", null);

      let copyResult;
      try {
        copyResult = await copyDiagnosticReviewSummary(document, copyPort);
      } catch {
        copyResult = Object.freeze({ status: "failed", code: "copy-failed" });
      }
      outputInFlight = null;

      if (generation === copyGeneration && preparedDocument === document) {
        updateState(
          "ready",
          actionResult("copy", copyResult.status, copyResult.code ?? ""),
        );
      }

      return result(copyResult.status, {
        ...(copyResult.code ? { code: copyResult.code } : {}),
      });
    },

    async exportPrepared() {
      if (outputInFlight !== null) {
        return result("failed", { code: outputBusyCode() });
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
      outputInFlight = "export";
      updateState("exporting", null);

      let exportResult;
      try {
        exportResult = await exportDiagnosticDocument(document, exportPort);
      } catch {
        exportResult = Object.freeze({ status: "failed", code: "export-failed" });
      }
      outputInFlight = null;

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
