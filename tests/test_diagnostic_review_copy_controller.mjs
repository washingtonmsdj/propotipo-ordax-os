import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_COPY_SCHEMA } from "../system/contracts/diagnostic-copy.mjs";
import { DIAGNOSTIC_EXPORT_SCHEMA } from "../system/contracts/diagnostic-export.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { createDiagnosticReviewController } from "../system/services/diagnostics/controller.mjs";

const GENERATED_AT = "2026-09-18T23:45:00Z";

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return { connectivity: "online", capabilityIds: ["system.metrics"] };
    },
    subscribe() {
      return () => {};
    },
  });
}

function copyPort(copy) {
  return Object.freeze({ schema: DIAGNOSTIC_COPY_SCHEMA, copy });
}

function exportPort(save) {
  return Object.freeze({ schema: DIAGNOSTIC_EXPORT_SCHEMA, save });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("copy is impossible before an explicit prepared review exists", async () => {
  let calls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      calls += 1;
      return { status: "copied" };
    }),
    clock: () => GENERATED_AT,
  });

  assert.deepEqual(await controller.copyPreparedSummary(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "review-not-prepared",
  });
  assert.equal(calls, 0);
  assert.deepEqual(controller.getSnapshot().lastResult, {
    action: "copy",
    status: "failed",
    code: "review-not-prepared",
  });
});

test("copy uses the prepared review, publishes copying and keeps the review ready", async () => {
  const gate = deferred();
  let observedSummary = null;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async (summary) => {
      observedSummary = summary;
      await gate.promise;
      return { status: "copied" };
    }),
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(controller.getSnapshot().copyAvailable, true);

  const copying = controller.copyPreparedSummary();
  const active = controller.getSnapshot();
  assert.equal(active.phase, "copying");
  assert.equal(active.document, prepared.document);
  assert.equal(active.lastResult, null);
  assert.equal(observedSummary.schema, "ordax.diagnostic-summary/1");
  assert.match(observedSummary.text, /OrdaX — resumo sanitizado de diagnóstico/);
  assert.equal(observedSummary.text.includes(prepared.document.text), false);

  gate.resolve();
  assert.deepEqual(await copying, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "copied",
  });

  const ready = controller.getSnapshot();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.document, prepared.document);
  assert.deepEqual(ready.lastResult, {
    action: "copy",
    status: "copied",
    code: "",
  });
});

test("copy failure is stable, secret-free and retryable", async () => {
  let calls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("clipboard denied token=do-not-leak user@example.com 10.20.30.40");
      }
      return { status: "copied" };
    }),
    clock: () => GENERATED_AT,
  });
  const prepared = await controller.prepare();

  const failed = await controller.copyPreparedSummary();
  assert.deepEqual(failed, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "copy-failed",
  });
  assert.equal(controller.getSnapshot().document, prepared.document);
  assert.deepEqual(controller.getSnapshot().lastResult, {
    action: "copy",
    status: "failed",
    code: "copy-failed",
  });
  assert.doesNotMatch(JSON.stringify({ failed, snapshot: controller.getSnapshot() }), /do-not-leak|user@example\.com|10\.20\.30\.40/);

  assert.equal((await controller.copyPreparedSummary()).status, "copied");
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().document, prepared.document);
});

test("missing copy capability is explicit and does not discard the review", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    clock: () => GENERATED_AT,
  });
  const prepared = await controller.prepare();

  assert.deepEqual(await controller.copyPreparedSummary(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "copy-unavailable",
  });
  assert.equal(controller.getSnapshot().document, prepared.document);
  assert.equal(controller.getSnapshot().copyAvailable, false);
});

test("copy and export are mutually exclusive while either output action is active", async () => {
  const copyGate = deferred();
  const exportGate = deferred();
  let copyCalls = 0;
  let exportCalls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      copyCalls += 1;
      await copyGate.promise;
      return { status: "copied" };
    }),
    diagnosticExport: exportPort(async () => {
      exportCalls += 1;
      await exportGate.promise;
      return { status: "saved" };
    }),
    clock: () => GENERATED_AT,
  });
  await controller.prepare();

  const copying = controller.copyPreparedSummary();
  assert.deepEqual(await controller.exportPrepared(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "copy-in-progress",
  });
  assert.equal(copyCalls, 1);
  assert.equal(exportCalls, 0);
  copyGate.resolve();
  assert.equal((await copying).status, "copied");

  const exporting = controller.exportPrepared();
  assert.deepEqual(await controller.copyPreparedSummary(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "export-in-progress",
  });
  assert.equal(exportCalls, 1);
  exportGate.resolve();
  assert.equal((await exporting).status, "saved");
});

test("a newer prepare supersedes observable copy completion", async () => {
  const gate = deferred();
  const generated = [
    "2026-09-18T23:45:00Z",
    "2026-09-18T23:45:01Z",
  ];
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      await gate.promise;
      return { status: "copied" };
    }),
    clock: () => generated.shift(),
  });

  await controller.prepare();
  const copying = controller.copyPreparedSummary();
  const newer = await controller.prepare();
  assert.equal(newer.status, "ready");
  assert.equal(controller.getSnapshot().document.review.generatedAt, "2026-09-18T23:45:01Z");

  gate.resolve();
  assert.equal((await copying).status, "copied");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().document, newer.document);
  assert.deepEqual(controller.getSnapshot().lastResult, {
    action: "prepare",
    status: "ready",
    code: "",
  });
});

test("controller validates diagnostic copy capability at construction", () => {
  assert.throws(
    () => createDiagnosticReviewController({
      host: host(),
      diagnosticCopy: { schema: "wrong", copy() {} },
    }),
    TypeError,
  );
});
