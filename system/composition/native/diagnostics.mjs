import { createNativeDiagnosticExport } from "../../adapters/native/diagnostic-export.mjs";
import { createDiagnosticReviewController } from "../../services/diagnostics/controller.mjs";

export function createNativeDiagnosticReviewComposition({
  host,
  updateStatus = null,
  systemMetrics = null,
  updateHistory = null,
  diagnosticJournal = null,
  fileSpace = null,
  updateMaxAgeSeconds = undefined,
  clock = () => new Date().toISOString(),
}) {
  const diagnosticExport = fileSpace === null
    ? null
    : createNativeDiagnosticExport(fileSpace);

  return createDiagnosticReviewController({
    host,
    updateStatus,
    systemMetrics,
    updateHistory,
    diagnosticJournal,
    diagnosticExport,
    ...(updateMaxAgeSeconds === undefined
      ? {}
      : { updateMaxAgeSeconds }),
    clock,
  });
}
