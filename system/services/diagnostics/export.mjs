import {
  assertDiagnosticExportPort,
  validateDiagnosticExportDocument,
  validateDiagnosticExportSaveResult,
} from "../../contracts/diagnostic-export.mjs";

export const DIAGNOSTIC_EXPORT_RESULT_SCHEMA = "ordax.diagnostic-export-result/1";

function exportResult(status, code = "") {
  return Object.freeze({
    schema: DIAGNOSTIC_EXPORT_RESULT_SCHEMA,
    status,
    code,
  });
}

export async function exportDiagnosticDocument(document, exportPort) {
  const validatedDocument = validateDiagnosticExportDocument(document);
  const port = assertDiagnosticExportPort(exportPort);

  try {
    const result = validateDiagnosticExportSaveResult(
      await port.save(validatedDocument),
    );
    return exportResult(result.status);
  } catch {
    return exportResult("failed", "export-failed");
  }
}
