import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_REPORT_SCHEMA,
  createDiagnosticReport,
  createDiagnosticReportDocument,
} from "../system/services/diagnostics/report.mjs";
import {
  createUpdateDiagnosticEvent,
} from "../system/services/diagnostics/journal.mjs";
import {
  validateDiagnosticJournalRuntimeSnapshot,
} from "../system/services/diagnostics/runtime.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const TARGET_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const GENERATED_AT = "2026-09-18T22:30:00Z";

function updateSnapshot(overrides = {}) {
  return {
    sourceSha: SOURCE_SHA,
    deliveryNumber: 42,
    runtimeSurfaceSha: SOURCE_SHA,
    targetSha: TARGET_SHA,
    status: "network-error",
    phase: "error",
    applyMode: "none",
    attemptId: "attempt-42",
    bootRefreshRequired: false,
    checkedAt: "2026-09-18T22:29:59Z",
    lastAppliedSha: SOURCE_SHA,
    lastAppliedAt: "2026-09-18T21:00:00Z",
    rejectedSha: "",
    lastError: "token=secret-value user@example.com 10.20.30.40 /home/alice/private",
    healthToken: "raw-health-token-must-never-export",
    ...overrides,
  };
}

function journalSnapshot(event, overrides = {}) {
  return {
    events: [event],
    retentionLimit: 100,
    configuredStoreScope: "device",
    persistenceStatus: "degraded",
    persistenceErrorCode: "save-failed",
    ...overrides,
  };
}

function reviewInput(overrides = {}) {
  const update = updateSnapshot();
  const event = createUpdateDiagnosticEvent({
    update,
    occurredAt: "2026-09-18T22:29:58Z",
  });
  return {
    generatedAt: GENERATED_AT,
    surface: {
      connectivity: "online",
      capabilityIds: ["system.metrics", "network.https"],
    },
    update,
    journal: journalSnapshot(event),
    ...overrides,
  };
}

test("reviewable report v2 includes validated journal state and incident correlation", () => {
  const report = createDiagnosticReport(reviewInput());

  assert.equal(report.schema, DIAGNOSTIC_REPORT_SCHEMA);
  assert.equal(report.schema, "ordax.diagnostic-report/2");
  assert.equal(report.scope, "local-reviewable");
  assert.deepEqual(report.surface.capabilityIds, ["network.https", "system.metrics"]);
  assert.equal(report.update.healthTokenPresent, true);
  assert.equal(report.journal.eventCount, 1);
  assert.equal(report.journal.retentionLimit, 100);
  assert.equal(report.journal.configuredStoreScope, "device");
  assert.equal(report.journal.persistenceStatus, "degraded");
  assert.equal(report.journal.persistenceErrorCode, "save-failed");
  assert.equal(report.journal.events[0].correlationKey, "update:attempt:attempt-42");
  assert.equal(report.journal.events[0].severity, "error");
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.journal));
  assert.ok(Object.isFrozen(report.journal.events));
});

test("document is rebuilt from redacted allowlisted data and never serializes raw secrets", () => {
  const document = createDiagnosticReportDocument(reviewInput());

  assert.equal(document.mediaType, "application/json");
  assert.equal(document.fileName, "ordax-diagnostico-2026-09-18T22-30-00Z.json");
  assert.equal(JSON.parse(document.text).schema, "ordax.diagnostic-report/2");
  assert.match(document.text, /token=\[redacted\]/);
  assert.match(document.text, /\[email\]/);
  assert.match(document.text, /\[ip\]/);
  assert.match(document.text, /\/home\/\[user\]\/private/);
  assert.doesNotMatch(document.text, /secret-value/);
  assert.doesNotMatch(document.text, /user@example\.com/);
  assert.doesNotMatch(document.text, /10\.20\.30\.40/);
  assert.doesNotMatch(document.text, /\/home\/alice/);
  assert.doesNotMatch(document.text, /raw-health-token-must-never-export/);
  assert.doesNotMatch(document.text, /attemptId/);
});

test("journal runtime snapshot validation rejects states that could mislead review", () => {
  const event = createUpdateDiagnosticEvent({
    update: updateSnapshot({ lastError: "" }),
    occurredAt: "2026-09-18T22:29:58Z",
  });

  assert.throws(
    () => validateDiagnosticJournalRuntimeSnapshot({
      ...journalSnapshot(event),
      events: [event, event],
      retentionLimit: 1,
    }),
    /retention limit/,
  );
  assert.throws(
    () => validateDiagnosticJournalRuntimeSnapshot({
      ...journalSnapshot(event),
      persistenceStatus: "device",
      persistenceErrorCode: "",
      configuredStoreScope: "session",
    }),
    /must match configured store scope/,
  );
  assert.throws(
    () => validateDiagnosticJournalRuntimeSnapshot({
      ...journalSnapshot(event),
      persistenceStatus: "degraded",
      persistenceErrorCode: "",
    }),
    /requires an error code/,
  );
  assert.throws(
    () => validateDiagnosticJournalRuntimeSnapshot({
      ...journalSnapshot(event),
      persistenceStatus: "mystery",
    }),
    /persistenceStatus is invalid/,
  );
});

test("healthy runtime snapshot must state the actual configured persistence scope", () => {
  const event = createUpdateDiagnosticEvent({
    update: updateSnapshot({ status: "running", phase: "idle", lastError: "" }),
    occurredAt: "2026-09-18T22:29:58Z",
  });
  const snapshot = validateDiagnosticJournalRuntimeSnapshot({
    events: [event],
    retentionLimit: 100,
    configuredStoreScope: "device",
    persistenceStatus: "device",
    persistenceErrorCode: "",
  });

  assert.equal(snapshot.persistenceStatus, "device");
  assert.equal(snapshot.persistenceErrorCode, "");
  assert.equal(snapshot.events.length, 1);
});

test("journal remains optional so hosts without the capability can still build a review report", () => {
  const input = reviewInput();
  const report = createDiagnosticReport({
    generatedAt: input.generatedAt,
    surface: input.surface,
    update: input.update,
  });

  assert.equal(report.journal, null);
});
