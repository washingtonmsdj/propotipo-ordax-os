import {
  assertDiagnosticExportPort,
  validateDiagnosticExportDocument,
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
    const result = await port.save(validatedDocument);
    if (result === false || result?.status === "cancelled") {
      return exportResult("cancelled");
    }
    return exportResult("saved");
  } catch {
    return exportResult("failed", "export-failed");
  }
}
