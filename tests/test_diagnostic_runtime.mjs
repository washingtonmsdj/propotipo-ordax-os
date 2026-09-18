import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
  MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES,
  assertDiagnosticJournalStore,
  validateDiagnosticJournalPayload,
} from "../system/contracts/diagnostic-journal-store.mjs";
import {
  DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA,
  DIAGNOSTIC_JOURNAL_STATE_SCHEMA,
  createDiagnosticJournalRuntime,
} from "../system/services/diagnostics/runtime.mjs";

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
    healthToken: "must-never-persist",
    ...overrides,
  };
}

function memoryStore({
  scope = "device",
  initialPayload = null,
  failLoad = false,
  failSave = false,
} = {}) {
  let payload = initialPayload;
  let saveFailure = failSave;
  return {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope,
    async load() {
      if (failLoad) throw new Error("load unavailable");
      return payload;
    },
    async save(next) {
      if (saveFailure) throw new Error("save unavailable");
      payload = validateDiagnosticJournalPayload(next);
      return true;
    },
    payload() {
      return payload;
    },
    setSaveFailure(value) {
      saveFailure = value;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("diagnostic journal store contract is bounded and does not perform I/O during assertion", () => {
  let loads = 0;
  const store = {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: "device",
    load() {
      loads += 1;
      return null;
    },
    save() {
      return true;
    },
  };
  assert.equal(assertDiagnosticJournalStore(store), store);
  assert.equal(loads, 0);
  assert.equal(validateDiagnosticJournalPayload(null), null);
  assert.equal(validateDiagnosticJournalPayload("{}"), "{}");
  assert.throws(() => validateDiagnosticJournalPayload({}), TypeError);
  assert.throws(
    () => validateDiagnosticJournalPayload("x".repeat(MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES + 1)),
    TypeError,
  );
});

test("runtime without a store remains explicitly session-scoped", async () => {
  const runtime = await createDiagnosticJournalRuntime({ retentionLimit: 2 });
  assert.equal(runtime.schema, DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA);
  assert.deepEqual(runtime.getSnapshot(), {
    events: [],
    retentionLimit: 2,
    configuredStoreScope: "session",
    persistenceStatus: "session",
    persistenceErrorCode: "",
  });

  await runtime.appendUpdate(
    updateSnapshot({ lastError: "token=secret-value user@example.com" }),
    "2026-09-18T21:00:00Z",
  );
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.persistenceStatus, "session");
  assert.doesNotMatch(JSON.stringify(snapshot), /must-never-persist|secret-value|user@example\.com/);
});

test("device journal survives a runtime round trip with only validated redacted state", async () => {
  const store = memoryStore();
  const first = await createDiagnosticJournalRuntime({ store, retentionLimit: 3 });
  await first.appendUpdate(
    updateSnapshot({ attemptId: "attempt-1", lastError: "password=hunter2" }),
    "2026-09-18T21:00:00Z",
  );
  await first.appendUpdate(
    updateSnapshot({ attemptId: "attempt-2" }),
    "2026-09-18T21:00:01Z",
  );

  const persisted = store.payload();
  assert.equal(typeof persisted, "string");
  assert.doesNotMatch(persisted, /must-never-persist|hunter2/);
  const parsed = JSON.parse(persisted);
  assert.equal(parsed.$schema, DIAGNOSTIC_JOURNAL_STATE_SCHEMA);
  assert.equal(parsed.events.length, 2);

  const second = await createDiagnosticJournalRuntime({ store, retentionLimit: 3 });
  assert.equal(second.getSnapshot().events.length, 2);
  assert.equal(second.getSnapshot().persistenceStatus, "device");
});

test("corrupt persisted state degrades safely and self-heals on the next valid write", async () => {
  const store = memoryStore({ initialPayload: "{not-json" });
  const runtime = await createDiagnosticJournalRuntime({ store });
  assert.deepEqual(runtime.getSnapshot().events, []);
  assert.equal(runtime.getSnapshot().persistenceStatus, "degraded");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "load-failed");

  await runtime.appendUpdate(updateSnapshot(), "2026-09-18T21:00:00Z");
  assert.equal(runtime.getSnapshot().events.length, 1);
  assert.equal(runtime.getSnapshot().persistenceStatus, "device");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "");
  assert.equal(JSON.parse(store.payload()).events.length, 1);
});

test("store failure never discards the in-memory event or throws from append", async () => {
  const store = memoryStore({ failSave: true });
  const runtime = await createDiagnosticJournalRuntime({ store });
  const event = await runtime.appendUpdate(updateSnapshot(), "2026-09-18T21:00:00Z");

  assert.equal(event.eventCode, "system.update.state");
  assert.equal(runtime.getSnapshot().events.length, 1);
  assert.equal(runtime.getSnapshot().persistenceStatus, "degraded");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "save-failed");

  store.setSaveFailure(false);
  await runtime.appendUpdate(
    updateSnapshot({ attemptId: "attempt-recovered" }),
    "2026-09-18T21:00:01Z",
  );
  assert.equal(runtime.getSnapshot().persistenceStatus, "device");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "");
  assert.equal(JSON.parse(store.payload()).events.length, 2);
});

test("runtime applies retention before persistence and recovery", async () => {
  const store = memoryStore();
  const runtime = await createDiagnosticJournalRuntime({ store, retentionLimit: 2 });
  for (let index = 0; index < 4; index += 1) {
    await runtime.appendUpdate(
      updateSnapshot({ attemptId: `attempt-${index}` }),
      `2026-09-18T21:00:0${index}Z`,
    );
  }

  assert.deepEqual(
    runtime.getSnapshot().events.map((event) => event.correlationKey),
    ["update:attempt:attempt-2", "update:attempt:attempt-3"],
  );
  assert.equal(JSON.parse(store.payload()).events.length, 2);

  const recovered = await createDiagnosticJournalRuntime({ store, retentionLimit: 1 });
  assert.deepEqual(
    recovered.getSnapshot().events.map((event) => event.correlationKey),
    ["update:attempt:attempt-3"],
  );
});

test("concurrent appends serialize store writes so stale state cannot win", async () => {
  const firstWriteGate = deferred();
  const writes = [];
  let persisted = null;
  const store = {
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: "device",
    async load() {
      return null;
    },
    async save(payload) {
      writes.push(payload);
      if (writes.length === 1) await firstWriteGate.promise;
      persisted = payload;
      return true;
    },
  };
  const runtime = await createDiagnosticJournalRuntime({ store });

  const first = runtime.appendUpdate(
    updateSnapshot({ attemptId: "attempt-first" }),
    "2026-09-18T21:00:00Z",
  );
  await new Promise((resolve) => setImmediate(resolve));
  const second = runtime.appendUpdate(
    updateSnapshot({ attemptId: "attempt-second" }),
    "2026-09-18T21:00:01Z",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  firstWriteGate.resolve();
  await Promise.all([first, second]);

  assert.equal(writes.length, 2);
  const finalState = JSON.parse(persisted);
  assert.deepEqual(
    finalState.events.map((event) => event.correlationKey),
    ["update:attempt:attempt-first", "update:attempt:attempt-second"],
  );
});
