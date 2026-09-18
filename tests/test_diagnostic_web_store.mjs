import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES,
} from "../system/contracts/diagnostic-journal-store.mjs";
import {
  WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY,
  createWebDiagnosticJournalStore,
} from "../system/adapters/web/diagnostic-journal-store.mjs";
import {
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
    attemptId: "web-attempt",
    lastError: "",
    healthToken: "private-health-token",
    ...overrides,
  };
}

function fakeStorage({ initial = null, failGet = false, failSet = false } = {}) {
  let value = initial;
  const calls = [];
  return {
    calls,
    getItem(key) {
      calls.push(["get", key]);
      if (failGet) throw new Error("storage read denied");
      return value;
    },
    setItem(key, next) {
      calls.push(["set", key, next]);
      if (failSet) throw new Error("quota exceeded");
      value = String(next);
    },
    removeItem(key) {
      calls.push(["remove", key]);
      if (failSet) throw new Error("storage remove denied");
      value = null;
    },
    value() {
      return value;
    },
  };
}

test("Web diagnostic journal uses its own dedicated persistent storage key", () => {
  assert.equal(WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY, "ordax.diagnostic-journal.v1");
  assert.notEqual(WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY, "ordax.sync-state.v1");
});

test("Web adapter exposes device scope only with a complete Storage capability", () => {
  const storage = fakeStorage();
  const store = createWebDiagnosticJournalStore({ localStorage: storage });
  assert.equal(store.scope, "device");

  assert.equal(store.save('{"ok":true}'), true);
  assert.equal(store.load(), '{"ok":true}');
  assert.equal(storage.calls.at(-1)[1], WEB_DIAGNOSTIC_JOURNAL_STORAGE_KEY);

  assert.equal(store.save(null), true);
  assert.equal(store.load(), null);
  assert.equal(storage.value(), null);
});

test("denied or incomplete browser storage degrades honestly to session scope", () => {
  const deniedWindow = {};
  Object.defineProperty(deniedWindow, "localStorage", {
    get() {
      throw new Error("storage policy denied");
    },
  });
  const deniedStore = createWebDiagnosticJournalStore(deniedWindow);
  assert.equal(deniedStore.scope, "session");
  deniedStore.save("session-value");
  assert.equal(deniedStore.load(), "session-value");

  const incompleteStore = createWebDiagnosticJournalStore({
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
  });
  assert.equal(incompleteStore.scope, "session");
});

test("adapter validates payload before writing browser storage", () => {
  const storage = fakeStorage();
  const store = createWebDiagnosticJournalStore({ localStorage: storage });
  assert.throws(
    () => store.save("x".repeat(MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES + 1)),
    TypeError,
  );
  assert.equal(storage.calls.length, 0);
});

test("corrupt persistent browser state is surfaced to the runtime as degraded", async () => {
  const storage = fakeStorage({ initial: "{not-json" });
  const store = createWebDiagnosticJournalStore({ localStorage: storage });
  const runtime = await createDiagnosticJournalRuntime({ store });

  assert.equal(runtime.getSnapshot().configuredStoreScope, "device");
  assert.equal(runtime.getSnapshot().persistenceStatus, "degraded");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "load-failed");
  assert.deepEqual(runtime.getSnapshot().events, []);
});

test("browser quota failure does not masquerade as durable diagnostics", async () => {
  const storage = fakeStorage({ failSet: true });
  const store = createWebDiagnosticJournalStore({ localStorage: storage });
  const runtime = await createDiagnosticJournalRuntime({ store });

  await runtime.appendUpdate(
    updateSnapshot({ lastError: "token=secret-value" }),
    "2026-09-18T21:00:00Z",
  );

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.persistenceStatus, "degraded");
  assert.equal(snapshot.persistenceErrorCode, "save-failed");
  assert.doesNotMatch(JSON.stringify(snapshot), /private-health-token|secret-value/);
});

test("browser read failure is not silently converted into a healthy device store", async () => {
  const storage = fakeStorage({ failGet: true });
  const store = createWebDiagnosticJournalStore({ localStorage: storage });
  assert.equal(store.scope, "device");

  const runtime = await createDiagnosticJournalRuntime({ store });
  assert.equal(runtime.getSnapshot().persistenceStatus, "degraded");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "load-failed");
});
