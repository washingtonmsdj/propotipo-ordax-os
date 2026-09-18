import assert from "node:assert/strict";
import test from "node:test";

import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import { UPDATE_HISTORY_SCHEMA } from "../system/contracts/update-history.mjs";
import { UPDATE_STATUS_SCHEMA } from "../system/contracts/update-status.mjs";
import {
  DIAGNOSTIC_REVIEW_SCHEMA,
  createDiagnosticReview,
  createDiagnosticReviewDocument,
} from "../system/services/diagnostics/review.mjs";
import { DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA } from "../system/services/diagnostics/runtime.mjs";

const GENERATED_AT = "2026-09-18T22:45:00Z";
const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

function createHost(snapshot = { connectivity: "online", capabilityIds: ["network.https"] }) {
  return {
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
  };
}

function createUpdatePort(snapshot = {}) {
  const value = {
    sourceSha: SOURCE_SHA,
    status: "running",
    phase: "idle",
    applyMode: "none",
    checkedAt: "2026-09-18T22:44:30Z",
    ...snapshot,
  };
  return {
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      return value;
    },
    subscribe() {
      return () => {};
    },
  };
}

function createMetricsPort() {
  return {
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      return {
        uptimeSeconds: 90,
        memoryTotalBytes: 1024,
        memoryAvailableBytes: 512,
        userStorageTotalBytes: 4096,
        userStorageFreeBytes: 2048,
      };
    },
  };
}

function createHistoryPort() {
  return {
    schema: UPDATE_HISTORY_SCHEMA,
    async list() {
      return { releases: [], applications: [] };
    },
  };
}

function createJournalRuntime() {
  return {
    schema: DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA,
    getSnapshot() {
      return {
        events: [],
        retentionLimit: 100,
        configuredStoreScope: "session",
        persistenceStatus: "session",
        persistenceErrorCode: "",
      };
    },
  };
}

test("explicit review includes available neutral sources and freshness", async () => {
  const review = await createDiagnosticReview({
    generatedAt: GENERATED_AT,
    host: createHost(),
    updateStatus: createUpdatePort(),
    systemMetrics: createMetricsPort(),
    updateHistory: createHistoryPort(),
    diagnosticJournal: createJournalRuntime(),
  });

  assert.equal(review.schema, DIAGNOSTIC_REVIEW_SCHEMA);
  assert.equal(review.scope, "explicit-local-review");
  assert.deepEqual(review.manifest.includedSourceIds, [
    "surface",
    "update",
    "metrics",
    "history",
    "journal",
  ]);
  assert.deepEqual(review.manifest.unavailableSourceIds, []);
  assert.deepEqual(review.manifest.failedSourceIds, []);
  assert.equal(review.manifest.hasFailures, false);
  assert.equal(review.observations.updateFreshness.state, "fresh");
  assert.equal(review.observations.updateFreshness.ageSeconds, 30);
  assert.equal(review.report.update.status, "running");
  assert.equal(review.report.metrics.memoryAvailableBytes, 512);
  assert.equal(review.report.journal.persistenceStatus, "session");
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.manifest));
});

test("optional sources that are not exposed remain visibly unavailable", async () => {
  const review = await createDiagnosticReview({
    generatedAt: GENERATED_AT,
    host: createHost(),
  });

  assert.deepEqual(review.manifest.includedSourceIds, ["surface"]);
  assert.deepEqual(review.manifest.unavailableSourceIds, [
    "update",
    "metrics",
    "history",
    "journal",
  ]);
  assert.deepEqual(review.manifest.failedSourceIds, []);
  assert.equal(review.observations.updateFreshness, null);
  assert.equal(review.report.update, null);
  assert.equal(review.report.metrics, null);
  assert.equal(review.report.history, null);
  assert.equal(review.report.journal, null);
});

test("source failures are fail-soft and raw exception text is never exported", async () => {
  const secret = "token=raw-secret user@example.com 10.20.30.40";
  const failingHost = {
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      throw new Error(secret);
    },
    subscribe() {
      return () => {};
    },
  };
  const failingUpdate = {
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      throw new Error(secret);
    },
    subscribe() {
      return () => {};
    },
  };
  const failingMetrics = {
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      throw new Error(secret);
    },
  };
  const failingHistory = {
    schema: UPDATE_HISTORY_SCHEMA,
    async list() {
      throw new Error(secret);
    },
  };
  const failingJournal = {
    schema: DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA,
    getSnapshot() {
      throw new Error(secret);
    },
  };

  const document = await createDiagnosticReviewDocument({
    generatedAt: GENERATED_AT,
    host: failingHost,
    updateStatus: failingUpdate,
    systemMetrics: failingMetrics,
    updateHistory: failingHistory,
    diagnosticJournal: failingJournal,
  });

  assert.deepEqual(document.review.manifest.failedSourceIds, [
    "surface",
    "update",
    "metrics",
    "history",
    "journal",
  ]);
  assert.equal(document.review.manifest.hasFailures, true);
  assert.equal(document.review.report.surface.connectivity, "unknown");
  assert.deepEqual(document.review.report.surface.capabilityIds, []);
  assert.match(document.text, /surface-read-failed/);
  assert.match(document.text, /update-read-failed/);
  assert.match(document.text, /metrics-read-failed/);
  assert.match(document.text, /history-read-failed/);
  assert.match(document.text, /journal-read-failed/);
  assert.doesNotMatch(document.text, /raw-secret/);
  assert.doesNotMatch(document.text, /user@example\.com/);
  assert.doesNotMatch(document.text, /10\.20\.30\.40/);
});

test("document generation is deterministic for a fixed explicit review", async () => {
  const input = {
    generatedAt: GENERATED_AT,
    host: createHost(),
    updateStatus: createUpdatePort(),
  };
  const first = await createDiagnosticReviewDocument(input);
  const second = await createDiagnosticReviewDocument(input);

  assert.equal(first.mediaType, "application/json");
  assert.equal(
    first.fileName,
    "ordax-revisao-diagnostico-2026-09-18T22-45-00Z.json",
  );
  assert.equal(first.text, second.text);
  assert.equal(JSON.parse(first.text).schema, "ordax.diagnostic-review/1");
});

test("freshness policy is applied at review time without changing update status", async () => {
  const review = await createDiagnosticReview({
    generatedAt: GENERATED_AT,
    host: createHost(),
    updateStatus: createUpdatePort({ checkedAt: "2026-09-18T22:44:30Z" }),
    updateMaxAgeSeconds: 20,
  });

  assert.equal(review.report.update.status, "running");
  assert.equal(review.observations.updateFreshness.state, "stale");
  assert.equal(review.observations.updateFreshness.ageSeconds, 30);
});
