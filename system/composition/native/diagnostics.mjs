import { createNativeDiagnosticCopy } from "../../adapters/native/diagnostic-copy.mjs";
import { createNativeDiagnosticExport } from "../../adapters/native/diagnostic-export.mjs";
import { createDiagnosticReviewController } from "../../services/diagnostics/controller.mjs";

export function createNativeDiagnosticReviewComposition({
  host,
  updateStatus = null,
  systemMetrics = null,
  updateHistory = null,
  diagnosticJournal = null,
  fileSpace = null,
  clipboard = globalThis.navigator?.clipboard ?? null,
  updateMaxAgeSeconds = undefined,
  clock = () => new Date().toISOString(),
}) {
  const diagnosticExport = fileSpace === null
    ? null
    : createNativeDiagnosticExport(fileSpace);
  const diagnosticCopy = clipboard === null
    ? null
    : createNativeDiagnosticCopy(clipboard);

  return createDiagnosticReviewController({
    host,
    updateStatus,
    systemMetrics,
    updateHistory,
    diagnosticJournal,
    diagnosticExport,
    diagnosticCopy,
    ...(updateMaxAgeSeconds === undefined
      ? {}
      : { updateMaxAgeSeconds }),
    clock,
  });
}
