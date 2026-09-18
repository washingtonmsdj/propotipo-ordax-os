import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_EXPORT_SCHEMA,
  MAX_DIAGNOSTIC_EXPORT_TEXT_CHARS,
  validateDiagnosticExportDocument,
  validateDiagnosticExportSaveResult,
} from "../system/contracts/diagnostic-export.mjs";
import {
  DIAGNOSTIC_EXPORT_RESULT_SCHEMA,
  exportDiagnosticDocument,
} from "../system/services/diagnostics/export.mjs";

function document(overrides = {}) {
  return {
    fileName: "ordax-revisao-diagnostico-2026-09-18T22-45-00Z.json",
    mediaType: "application/json",
    text: "{\"schema\":\"ordax.diagnostic-review/1\"}\n",
    ...overrides,
  };
}

function exportPort(save) {
  return {
    schema: DIAGNOSTIC_EXPORT_SCHEMA,
    save,
  };
}

test("diagnostic export document is bounded, JSON-only and basename-only", () => {
  const validated = validateDiagnosticExportDocument(document());
  assert.ok(Object.isFrozen(validated));
  assert.equal(validated.mediaType, "application/json");

  for (const fileName of [
    "../diagnostico.json",
    "folder/diagnostico.json",
    "folder\\diagnostico.json",
    ".json",
    "diagnostico.txt",
  ]) {
    assert.throws(
      () => validateDiagnosticExportDocument(document({ fileName })),
      TypeError,
    );
  }

  assert.throws(
    () => validateDiagnosticExportDocument(document({ mediaType: "text/plain" })),
    TypeError,
  );
  assert.throws(
    () => validateDiagnosticExportDocument(document({ text: "" })),
    TypeError,
  );
  assert.throws(
    () => validateDiagnosticExportDocument(document({
      text: "x".repeat(MAX_DIAGNOSTIC_EXPORT_TEXT_CHARS + 1),
    })),
    TypeError,
  );
});

test("export calls the narrow port only after document validation", async () => {
  let calls = 0;
  let received = null;
  const result = await exportDiagnosticDocument(
    document(),
    exportPort(async (value) => {
      calls += 1;
      received = value;
      return { status: "saved" };
    }),
  );

  assert.equal(calls, 1);
  assert.deepEqual(received, document());
  assert.deepEqual(result, {
    schema: DIAGNOSTIC_EXPORT_RESULT_SCHEMA,
    status: "saved",
    code: "",
  });
  assert.ok(Object.isFrozen(result));
});

test("explicit cancellation is preserved as cancellation", async () => {
  const result = await exportDiagnosticDocument(
    document(),
    exportPort(async () => ({ status: "cancelled" })),
  );

  assert.equal(validateDiagnosticExportSaveResult({ status: "cancelled" }).status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.equal(result.code, "");
});

test("adapter exceptions and invalid adapter results fail closed without leaking text", async () => {
  const secret = "token=raw-secret user@example.com";
  const thrown = await exportDiagnosticDocument(
    document(),
    exportPort(async () => {
      throw new Error(secret);
    }),
  );
  const malformed = await exportDiagnosticDocument(
    document(),
    exportPort(async () => ({ status: "maybe" })),
  );

  for (const result of [thrown, malformed]) {
    assert.deepEqual(result, {
      schema: DIAGNOSTIC_EXPORT_RESULT_SCHEMA,
      status: "failed",
      code: "export-failed",
    });
    assert.doesNotMatch(JSON.stringify(result), /raw-secret|user@example\.com/);
  }
});

test("invalid document is rejected before the adapter can write anything", async () => {
  let calls = 0;
  await assert.rejects(
    exportDiagnosticDocument(
      document({ fileName: "../escape.json" }),
      exportPort(async () => {
        calls += 1;
        return { status: "saved" };
      }),
    ),
    TypeError,
  );
  assert.equal(calls, 0);
});
