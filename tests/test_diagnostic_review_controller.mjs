import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_EXPORT_SCHEMA } from "../system/contracts/diagnostic-export.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import {
  createDiagnosticReviewController,
} from "../system/services/diagnostics/controller.mjs";

const GENERATED_AT = "2026-09-18T23:15:00Z";

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return {
        connectivity: "online",
        capabilityIds: ["filesystem.user-space"],
      };
    },
    subscribe() {
      return () => {};
    },
  });
}

function exportPort(save) {
  return Object.freeze({
    schema: DIAGNOSTIC_EXPORT_SCHEMA,
    save,
  });
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

test("export is impossible before an explicit prepared review exists", async () => {
  let saveCalls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => {
      saveCalls += 1;
      return { status: "saved" };
    }),
    clock: () => GENERATED_AT,
  });

  assert.deepEqual(await controller.exportPrepared(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "review-not-prepared",
  });
  assert.equal(saveCalls, 0);
});

test("prepare creates the review document and saved export consumes exactly that prepared revision", async () => {
  let observedDocument = null;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async (document) => {
      observedDocument = document;
      return { status: "saved" };
    }),
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.document.review.schema, "ordax.diagnostic-review/1");
  assert.equal(prepared.document.review.generatedAt, GENERATED_AT);

  const exported = await controller.exportPrepared({
    fileName: "attacker.json",
    mediaType: "application/json",
    text: "{}",
  });
  assert.equal(exported.status, "saved");
  assert.equal(observedDocument.fileName, prepared.document.fileName);
  assert.equal(observedDocument.text, prepared.document.text);
  assert.notEqual(observedDocument.fileName, "attacker.json");

  const second = await controller.exportPrepared();
  assert.equal(second.status, "failed");
  assert.equal(second.code, "review-not-prepared");
});

test("failed export keeps the prepared review available for an explicit retry", async () => {
  let calls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => {
      calls += 1;
      if (calls === 1) throw new Error("disk error token=do-not-leak");
      return { status: "saved" };
    }),
    clock: () => GENERATED_AT,
  });

  await controller.prepare();
  const failed = await controller.exportPrepared();
  assert.deepEqual(failed, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "export-failed",
  });
  assert.doesNotMatch(JSON.stringify(failed), /do-not-leak/);

  const retry = await controller.exportPrepared();
  assert.equal(retry.status, "saved");
  assert.equal(calls, 2);
});

test("cancelled export keeps the prepared review available", async () => {
  let status = "cancelled";
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => ({ status })),
    clock: () => GENERATED_AT,
  });

  await controller.prepare();
  assert.equal((await controller.exportPrepared()).status, "cancelled");
  status = "saved";
  assert.equal((await controller.exportPrepared()).status, "saved");
});

test("missing export capability is explicit and does not discard the prepared review", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(prepared.status, "ready");
  const unavailable = await controller.exportPrepared();
  assert.deepEqual(unavailable, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "export-unavailable",
  });
});

test("a newer prepare supersedes an older in-flight review instead of restoring stale material", async () => {
  const firstRead = deferred();
  let reads = 0;
  const metrics = Object.freeze({
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      reads += 1;
      if (reads === 1) return firstRead.promise;
      return {
        uptimeSeconds: 20,
        memoryTotalBytes: 100,
        memoryAvailableBytes: 50,
        userStorageTotalBytes: 1000,
        userStorageFreeBytes: 500,
      };
    },
  });
  const generated = [
    "2026-09-18T23:15:00Z",
    "2026-09-18T23:15:01Z",
  ];
  const controller = createDiagnosticReviewController({
    host: host(),
    systemMetrics: metrics,
    clock: () => generated.shift(),
  });

  const first = controller.prepare();
  await Promise.resolve();
  const second = controller.prepare();
  const newer = await second;
  assert.equal(newer.status, "ready");
  assert.equal(newer.document.review.generatedAt, "2026-09-18T23:15:01Z");

  firstRead.resolve({
    uptimeSeconds: 10,
    memoryTotalBytes: 100,
    memoryAvailableBytes: 40,
    userStorageTotalBytes: 1000,
    userStorageFreeBytes: 400,
  });
  const older = await first;
  assert.deepEqual(older, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "superseded",
  });
});

test("concurrent export attempts cannot write the same prepared review twice", async () => {
  const gate = deferred();
  let calls = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => {
      calls += 1;
      await gate.promise;
      return { status: "saved" };
    }),
    clock: () => GENERATED_AT,
  });

  await controller.prepare();
  const first = controller.exportPrepared();
  const second = await controller.exportPrepared();
  assert.deepEqual(second, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "export-in-progress",
  });
  assert.equal(calls, 1);

  gate.resolve();
  assert.equal((await first).status, "saved");
});

test("controller validates export capability and clock at construction", () => {
  assert.throws(
    () => createDiagnosticReviewController({ host: host(), clock: null }),
    TypeError,
  );
  assert.throws(
    () => createDiagnosticReviewController({
      host: host(),
      diagnosticExport: { schema: "wrong", save() {} },
    }),
    TypeError,
  );
});
