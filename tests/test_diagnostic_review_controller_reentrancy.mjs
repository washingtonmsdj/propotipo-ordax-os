import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_EXPORT_SCHEMA } from "../system/contracts/diagnostic-export.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { createDiagnosticReviewController } from "../system/services/diagnostics/controller.mjs";

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return { connectivity: "online", capabilityIds: [] };
    },
    subscribe() {
      return () => {};
    },
  });
}

test("idle publication after save is not emitted while export is still internally locked", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: Object.freeze({
      schema: DIAGNOSTIC_EXPORT_SCHEMA,
      async save() {
        return { status: "saved" };
      },
    }),
    clock: () => "2026-09-18T23:35:00Z",
  });

  await controller.prepare();
  let reentrant = null;
  controller.subscribe((snapshot) => {
    if (snapshot.phase === "idle" && snapshot.lastResult?.status === "saved" && reentrant === null) {
      reentrant = controller.exportPrepared();
    }
  });

  assert.equal((await controller.exportPrepared()).status, "saved");
  assert.notEqual(reentrant, null);
  const result = await reentrant;
  assert.equal(result.status, "failed");
  assert.equal(result.code, "review-not-prepared");
  assert.notEqual(result.code, "export-in-progress");
});
