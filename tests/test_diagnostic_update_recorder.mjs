import assert from "node:assert/strict";
import test from "node:test";

import { UPDATE_STATUS_SCHEMA } from "../system/contracts/update-status.mjs";
import { createDiagnosticJournalRuntime } from "../system/services/diagnostics/runtime.mjs";
import { createUpdateDiagnosticRecorder } from "../system/services/diagnostics/update-recorder.mjs";

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
    ...overrides,
  };
}

function updatePort(initial = null) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (snapshot) listener(snapshot);
      return () => listeners.delete(listener);
    },
    emit(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(next);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

test("recorder writes the initial state exactly once even when subscribe replays it", async () => {
  const updates = updatePort(updateSnapshot());
  const journal = await createDiagnosticJournalRuntime();
  const recorder = createUpdateDiagnosticRecorder(updates, journal, {
    now: () => "2026-09-18T21:00:00Z",
  });

  await recorder.flush();
  assert.equal(journal.getSnapshot().events.length, 1);
  assert.equal(updates.listenerCount(), 1);
  recorder.dispose();
  assert.equal(updates.listenerCount(), 0);
});

test("poll-only fields do not create duplicate diagnostic events", async () => {
  const updates = updatePort(updateSnapshot({ checkedAt: "2026-09-18T21:00:00Z" }));
  const journal = await createDiagnosticJournalRuntime();
  let tick = 0;
  const recorder = createUpdateDiagnosticRecorder(updates, journal, {
    now: () => `2026-09-18T21:00:0${tick++}Z`,
  });

  updates.emit(updateSnapshot({ checkedAt: "2026-09-18T21:00:01Z" }));
  updates.emit(updateSnapshot({ checkedAt: "2026-09-18T21:00:02Z" }));
  await recorder.flush();

  assert.equal(journal.getSnapshot().events.length, 1);
  recorder.dispose();
});

test("semantic update transitions are recorded in observation order", async () => {
  const updates = updatePort(updateSnapshot());
  const journal = await createDiagnosticJournalRuntime();
  const times = [
    "2026-09-18T21:00:00Z",
    "2026-09-18T21:00:01Z",
    "2026-09-18T21:00:02Z",
  ];
  const recorder = createUpdateDiagnosticRecorder(updates, journal, {
    now: () => times.shift(),
  });

  updates.emit(updateSnapshot({ status: "updating", phase: "fetching" }));
  updates.emit(updateSnapshot({ status: "updating", phase: "validating" }));
  await recorder.flush();

  assert.deepEqual(
    journal.getSnapshot().events.map((event) => [event.status, event.phase, event.occurredAt]),
    [
      ["running", "idle", "2026-09-18T21:00:00Z"],
      ["updating", "fetching", "2026-09-18T21:00:01Z"],
      ["updating", "validating", "2026-09-18T21:00:02Z"],
    ],
  );
  recorder.dispose();
});

test("recorder captures meaningful completion fields but excludes health token churn", async () => {
  const updates = updatePort(updateSnapshot({ healthToken: "first-token" }));
  const journal = await createDiagnosticJournalRuntime();
  const recorder = createUpdateDiagnosticRecorder(updates, journal, {
    now: () => "2026-09-18T21:00:00Z",
  });

  updates.emit(updateSnapshot({ healthToken: "second-token" }));
  await recorder.flush();
  assert.equal(journal.getSnapshot().events.length, 1);

  updates.emit(updateSnapshot({
    healthToken: "third-token",
    lastAppliedSha: SOURCE_SHA,
    lastAppliedAt: "2026-09-18T21:00:05Z",
    lastApplyDurationSeconds: 5,
  }));
  await recorder.flush();
  assert.equal(journal.getSnapshot().events.length, 2);
  assert.doesNotMatch(JSON.stringify(journal.getSnapshot()), /first-token|second-token|third-token/);
  recorder.dispose();
});

test("dispose prevents future observations from entering the journal", async () => {
  const updates = updatePort(updateSnapshot());
  const journal = await createDiagnosticJournalRuntime();
  const recorder = createUpdateDiagnosticRecorder(updates, journal);
  await recorder.flush();
  recorder.dispose();

  updates.emit(updateSnapshot({ status: "pull-error", phase: "error" }));
  await recorder.flush();
  assert.equal(journal.getSnapshot().events.length, 1);
});
