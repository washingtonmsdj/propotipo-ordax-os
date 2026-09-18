import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_EVENT_SCHEMA,
  UPDATE_COMPONENT,
  UPDATE_STATE_EVENT_CODE,
  appendDiagnosticEvent,
  createUpdateDiagnosticEvent,
  rotateDiagnosticEvents,
  validateDiagnosticEvent,
} from "../system/services/diagnostics/journal.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

function updateSnapshot(overrides = {}) {
  return {
    sourceSha: SOURCE_SHA,
    deliveryNumber: 42,
    status: "running",
    phase: "idle",
    applyMode: "none",
    attemptId: "attempt-42",
    lastError: "",
    healthToken: "private-health-token",
    ...overrides,
  };
}

test("update diagnostic event has stable machine identity and no health token", () => {
  const event = createUpdateDiagnosticEvent({
    occurredAt: "2026-09-18T21:00:00Z",
    update: updateSnapshot({
      lastError: "token=secret-value user@example.com 192.168.1.5",
    }),
  });

  assert.equal(event.$schema, DIAGNOSTIC_EVENT_SCHEMA);
  assert.equal(event.$schema, "ordax.diagnostic-event/2");
  assert.equal(event.eventCode, UPDATE_STATE_EVENT_CODE);
  assert.equal(event.eventCode, "system.update.state");
  assert.equal(event.component, UPDATE_COMPONENT);
  assert.equal(event.component, "update");
  assert.equal(event.severity, "info");
  assert.equal(event.correlationKey, "update:attempt:attempt-42");

  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /private-health-token|secret-value|user@example\.com|192\.168\.1\.5/);
  assert.match(serialized, /\[redacted\]|\[email\]|\[ip\]/);
});

test("severity is deterministic from the validated update state", () => {
  assert.equal(
    createUpdateDiagnosticEvent({ update: updateSnapshot({ phase: "error" }) }).severity,
    "error",
  );
  assert.equal(
    createUpdateDiagnosticEvent({ update: updateSnapshot({ status: "pull-error" }) }).severity,
    "error",
  );
  assert.equal(
    createUpdateDiagnosticEvent({ update: updateSnapshot({ phase: "rollback" }) }).severity,
    "warning",
  );
  assert.equal(
    createUpdateDiagnosticEvent({ update: updateSnapshot({ status: "rejected" }) }).severity,
    "warning",
  );
  assert.equal(
    createUpdateDiagnosticEvent({ update: updateSnapshot({ bootRefreshRequired: true }) }).severity,
    "warning",
  );
});

test("same update attempt keeps the same correlation across phase changes", () => {
  const first = createUpdateDiagnosticEvent({
    update: updateSnapshot({ phase: "fetching", status: "updating" }),
  });
  const second = createUpdateDiagnosticEvent({
    update: updateSnapshot({ phase: "validating", status: "updating" }),
  });
  assert.equal(first.correlationKey, second.correlationKey);
});

test("event validation fails closed on schema identity component and severity", () => {
  const valid = createUpdateDiagnosticEvent({ update: updateSnapshot() });

  for (const invalid of [
    { ...valid, $schema: "ordax.diagnostic-event/1" },
    { ...valid, eventCode: "other.event" },
    { ...valid, component: "other" },
    { ...valid, severity: "urgent" },
  ]) {
    assert.throws(() => validateDiagnosticEvent(invalid), TypeError);
  }
});

test("constructor cannot emit an event with an unbounded correlation key", () => {
  assert.throws(
    () => createUpdateDiagnosticEvent({
      update: updateSnapshot({ attemptId: `attempt-${"x".repeat(300)}` }),
    }),
    TypeError,
  );
});

test("journal rotation is bounded and keeps the newest validated events", () => {
  const events = Array.from({ length: 5 }, (_, index) =>
    createUpdateDiagnosticEvent({
      occurredAt: `2026-09-18T21:00:0${index}Z`,
      update: updateSnapshot({ attemptId: `attempt-${index}` }),
    }),
  );

  const rotated = rotateDiagnosticEvents(events, 3);
  assert.deepEqual(
    rotated.map((event) => event.correlationKey),
    ["update:attempt:attempt-2", "update:attempt:attempt-3", "update:attempt:attempt-4"],
  );

  const appended = appendDiagnosticEvent(rotated, events[0], 3);
  assert.deepEqual(
    appended.map((event) => event.correlationKey),
    ["update:attempt:attempt-3", "update:attempt:attempt-4", "update:attempt:attempt-0"],
  );
});
