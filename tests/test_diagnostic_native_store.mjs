import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES,
} from "../system/contracts/diagnostic-journal-store.mjs";
import {
  NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT,
  createNativeDiagnosticJournalStore,
} from "../system/adapters/native/diagnostic-journal-store.mjs";
import { createDiagnosticJournalRuntime } from "../system/services/diagnostics/runtime.mjs";

function response({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function fakeWindow({ initialPayload = null, failLoad = false, failSave = false } = {}) {
  const calls = [];
  let payload = initialPayload;
  return {
    calls,
    async fetch(url, options = {}) {
      calls.push({ url, options });
      if (url !== NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT) {
        throw new Error(`unexpected endpoint: ${url}`);
      }
      if ((options.method ?? "GET") === "GET") {
        if (failLoad) return response({ ok: false, status: 503 });
        return response({ body: { payload } });
      }
      if (options.method === "POST") {
        if (failSave) return response({ ok: false, status: 507 });
        payload = JSON.parse(options.body).payload;
        return response({ body: { ok: true } });
      }
      throw new Error(`unexpected method: ${options.method}`);
    },
    payload() {
      return payload;
    },
  };
}

test("Native diagnostic journal uses a dedicated bounded same-origin endpoint", async () => {
  assert.equal(NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT, "/__ordax/native/diagnostic-journal");
  assert.notEqual(NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT, "/__ordax/native/sync-state");

  const windowRef = fakeWindow();
  const store = await createNativeDiagnosticJournalStore(windowRef);
  assert.equal(store.scope, "device");
  assert.equal(windowRef.calls.length, 1);
  assert.deepEqual(windowRef.calls[0], {
    url: NATIVE_DIAGNOSTIC_JOURNAL_ENDPOINT,
    options: {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
  });
});

test("Native adapter validates load payload before claiming device persistence", async () => {
  await assert.rejects(
    () => createNativeDiagnosticJournalStore(fakeWindow({ initialPayload: {} })),
    TypeError,
  );
  await assert.rejects(
    () => createNativeDiagnosticJournalStore(fakeWindow({ failLoad: true })),
    /load failed: 503/,
  );
});

test("Native adapter validates payload before POST and commits memory only after success", async () => {
  const windowRef = fakeWindow({ initialPayload: "old" });
  const store = await createNativeDiagnosticJournalStore(windowRef);
  assert.equal(store.load(), "old");

  await assert.rejects(
    () => store.save("x".repeat(MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES + 1)),
    TypeError,
  );
  assert.equal(windowRef.calls.length, 1);

  await store.save("new");
  assert.equal(store.load(), "new");
  assert.equal(windowRef.payload(), "new");
  const post = windowRef.calls.at(-1);
  assert.equal(post.options.method, "POST");
  assert.equal(post.options.cache, "no-store");
  assert.equal(post.options.credentials, "same-origin");
  assert.equal(post.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(post.options.body), { payload: "new" });
});

test("Native save failure propagates to shared runtime degraded state without lying about memory", async () => {
  const windowRef = fakeWindow({ failSave: true });
  const store = await createNativeDiagnosticJournalStore(windowRef);
  const runtime = await createDiagnosticJournalRuntime({ store });

  await runtime.appendUpdate({
    sourceSha: "0123456789abcdef0123456789abcdef01234567",
    deliveryNumber: 42,
    status: "running",
    phase: "idle",
    applyMode: "none",
    attemptId: "native-attempt",
    lastError: "",
  }, "2026-09-18T21:00:00Z");

  assert.equal(runtime.getSnapshot().events.length, 1);
  assert.equal(runtime.getSnapshot().configuredStoreScope, "device");
  assert.equal(runtime.getSnapshot().persistenceStatus, "degraded");
  assert.equal(runtime.getSnapshot().persistenceErrorCode, "save-failed");
  assert.equal(store.load(), null);
});
