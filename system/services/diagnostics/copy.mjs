import {
  assertDiagnosticCopyPort,
  validateDiagnosticCopyResult,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";
import { createDiagnosticReviewSummary } from "./summary.mjs";

export const DIAGNOSTIC_COPY_RESULT_SCHEMA = "ordax.diagnostic-copy-result/1";

function copyResult(status, code = "") {
  return Object.freeze({
    schema: DIAGNOSTIC_COPY_RESULT_SCHEMA,
    status,
    code,
  });
}

export async function copyDiagnosticSummary(summary, copyPort) {
  const validatedSummary = validateDiagnosticSummary(summary);
  const port = assertDiagnosticCopyPort(copyPort);

  try {
    const result = validateDiagnosticCopyResult(
      await port.copy(validatedSummary),
    );
    return copyResult(result.status);
  } catch {
    return copyResult("failed", "copy-failed");
  }
}

export async function copyDiagnosticReviewSummary(document, copyPort) {
  const summary = createDiagnosticReviewSummary(document);
  return copyDiagnosticSummary(summary, copyPort);
}
