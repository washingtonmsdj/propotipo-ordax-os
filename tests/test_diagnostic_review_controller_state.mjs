import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_EXPORT_SCHEMA } from "../system/contracts/diagnostic-export.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import {
  DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
  createDiagnosticReviewController,
} from "../system/services/diagnostics/controller.mjs";

const GENERATED_AT = "2026-09-18T23:30:00Z";

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

function metricsPort(read) {
  return Object.freeze({ schema: SYSTEM_METRICS_SCHEMA, read });
}

function metricsSnapshot() {
  return {
    uptimeSeconds: 10,
    memoryTotalBytes: 100,
    memoryAvailableBytes: 50,
    userStorageTotalBytes: 1000,
    userStorageFreeBytes: 500,
  };
}

test("controller exposes an immutable initial state and replays it on subscribe", () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    clock: () => GENERATED_AT,
  });
  const seen = [];
  const unsubscribe = controller.subscribe((snapshot) => seen.push(snapshot));

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    schema: DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
    phase: "idle",
    exportAvailable: false,
    copyAvailable: false,
    document: null,
    lastResult: null,
  });
  assert.ok(Object.isFrozen(seen[0]));
  assert.deepEqual(controller.getSnapshot(), seen[0]);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
});

test("prepare publishes preparing then ready with the exact review document", async () => {
  const gate = deferred();
  const controller = createDiagnosticReviewController({
    host: host(),
    systemMetrics: metricsPort(async () => gate.promise),
    clock: () => GENERATED_AT,
  });
  const phases = [];
  controller.subscribe((snapshot) => phases.push(snapshot.phase));

  const preparing = controller.prepare();
  assert.equal(controller.getSnapshot().phase, "preparing");
  assert.equal(controller.getSnapshot().document, null);

  gate.resolve(metricsSnapshot());
  const result = await preparing;
  const ready = controller.getSnapshot();

  assert.equal(result.status, "ready");
  assert.equal(ready.phase, "ready");
  assert.equal(ready.document, result.document);
  assert.deepEqual(ready.lastResult, {
    action: "prepare",
    status: "ready",
    code: "",
  });
  assert.deepEqual(phases, ["idle", "preparing", "ready"]);
});

test("export publishes exporting then consumes the prepared review only after saved", async () => {
  const gate = deferred();
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => gate.promise),
    clock: () => GENERATED_AT,
  });
  await controller.prepare();

  const exporting = controller.exportPrepared();
  const active = controller.getSnapshot();
  assert.equal(active.phase, "exporting");
  assert.notEqual(active.document, null);
  assert.equal(active.lastResult, null);

  gate.resolve({ status: "saved" });
  const result = await exporting;
  const idle = controller.getSnapshot();
  assert.equal(result.status, "saved");
  assert.equal(idle.phase, "idle");
  assert.equal(idle.document, null);
  assert.deepEqual(idle.lastResult, {
    action: "export",
    status: "saved",
    code: "",
  });
});

test("cancelled and failed export keep the same prepared document for retry", async () => {
  let response = { status: "cancelled" };
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => response),
    clock: () => GENERATED_AT,
  });
  const prepared = await controller.prepare();

  assert.equal((await controller.exportPrepared()).status, "cancelled");
  const cancelled = controller.getSnapshot();
  assert.equal(cancelled.phase, "ready");
  assert.equal(cancelled.document, prepared.document);
  assert.deepEqual(cancelled.lastResult, {
    action: "export",
    status: "cancelled",
    code: "",
  });

  response = { status: "invalid-result" };
  const failed = await controller.exportPrepared();
  assert.equal(failed.status, "failed");
  assert.equal(failed.code, "export-failed");
  const retryable = controller.getSnapshot();
  assert.equal(retryable.phase, "ready");
  assert.equal(retryable.document, prepared.document);
  assert.deepEqual(retryable.lastResult, {
    action: "export",
    status: "failed",
    code: "export-failed",
  });
});

test("prepare failures become stable state/results without leaking exception text", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    clock() {
      throw new Error("clock token=do-not-leak user@example.com 10.20.30.40");
    },
  });

  const result = await controller.prepare();
  assert.deepEqual(result, {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "review-prepare-failed",
  });
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.phase, "idle");
  assert.equal(snapshot.document, null);
  assert.deepEqual(snapshot.lastResult, {
    action: "prepare",
    status: "failed",
    code: "review-prepare-failed",
  });
  assert.doesNotMatch(
    JSON.stringify({ result, snapshot }),
    /do-not-leak|user@example\.com|10\.20\.30\.40/,
  );
});

test("subscriber exceptions are isolated from prepare/export semantics", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => ({ status: "saved" })),
    clock: () => GENERATED_AT,
  });
  controller.subscribe(() => {
    throw new Error("presentation failure");
  });

  assert.equal((await controller.prepare()).status, "ready");
  assert.equal((await controller.exportPrepared()).status, "saved");
  assert.equal(controller.getSnapshot().phase, "idle");
});

test("a superseded older prepare cannot overwrite observable state from the newer review", async () => {
  const firstRead = deferred();
  let reads = 0;
  const controller = createDiagnosticReviewController({
    host: host(),
    systemMetrics: metricsPort(async () => {
      reads += 1;
      return reads === 1 ? firstRead.promise : metricsSnapshot();
    }),
    clock: (() => {
      const values = ["2026-09-18T23:30:00Z", "2026-09-18T23:30:01Z"];
      return () => values.shift();
    })(),
  });

  const oldPrepare = controller.prepare();
  await Promise.resolve();
  const newPrepare = controller.prepare();
  const newer = await newPrepare;
  assert.equal(newer.status, "ready");
  assert.equal(controller.getSnapshot().document.review.generatedAt, "2026-09-18T23:30:01Z");

  firstRead.resolve(metricsSnapshot());
  assert.equal((await oldPrepare).status, "superseded");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().document.review.generatedAt, "2026-09-18T23:30:01Z");
});

test("subscribe validates listener input", () => {
  const controller = createDiagnosticReviewController({ host: host() });
  assert.throws(() => controller.subscribe(null), TypeError);
});
