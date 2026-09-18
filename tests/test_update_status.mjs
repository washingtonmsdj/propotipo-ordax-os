import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_STATUS_SCHEMA,
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../system/contracts/update-status.mjs";
import {
  buildReloadUrl,
  createNativeUpdateWatcher,
} from "../system/adapters/native/update-runtime.mjs";

function fakeWindow() {
  return {
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            sourceSha: "0123456789012345678901234567890123456789",
            status: "running",
            applyMode: "initial",
          };
        },
      };
    },
    location: { href: "http://127.0.0.1:8765/composition/native/index.html?source=old", reload() {}, replace() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
}

test("update status contract normalizes optional fields", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    status: "running",
    applyMode: "initial",
  });
  assert.equal(snapshot.bootRefreshRequired, false);
  assert.equal(snapshot.targetSha, "");
  assert.equal(snapshot.phase, "idle");
  assert.equal(snapshot.attemptId, "");
  assert.equal(snapshot.checkedAt, "unknown");
  assert.equal(snapshot.lastAppliedSha, "");
  assert.equal(snapshot.rejectedSha, "");
  assert.equal(snapshot.lastError, "");
  assert.equal(snapshot.healthToken, "");
});

test("update status preserves transaction context", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    targetSha: "abcdef0123456789abcdef0123456789abcdef01",
    status: "applied",
    phase: "health-wait",
    applyMode: "reload",
    attemptId: "2026-09-18T09:10:00Z",
    lastError: "health-check-pending",
  });
  assert.equal(snapshot.targetSha, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(snapshot.phase, "health-wait");
  assert.equal(snapshot.attemptId, "2026-09-18T09:10:00Z");
  assert.equal(snapshot.lastError, "health-check-pending");
});

test("update status rejects unknown transaction phase", () => {
  assert.throws(
    () => validateUpdateStatusSnapshot({
      sourceSha: "0123456789012345678901234567890123456789",
      status: "running",
      phase: "mystery",
      applyMode: "none",
    }),
    TypeError,
  );
});

test("update status rejects missing runtime identity", () => {
  assert.throws(
    () => validateUpdateStatusSnapshot({ status: "running", applyMode: "initial" }),
    TypeError,
  );
});

test("native update watcher implements neutral update status port", () => {
  const watcher = createNativeUpdateWatcher(fakeWindow(), { intervalMs: 1 });
  assert.equal(watcher.schema, UPDATE_STATUS_SCHEMA);
  assert.equal(assertUpdateStatusPort(watcher), watcher);
  watcher.dispose();
});

test("native reload URL carries target SHA and bounded retry marker", () => {
  const url = buildReloadUrl(
    "http://127.0.0.1:8765/composition/native/index.html?source=old#surface",
    "abcdef0123456789abcdef0123456789abcdef01",
    3,
  );
  assert.equal(
    url,
    "http://127.0.0.1:8765/composition/native/index.html?source=abcdef0123456789abcdef0123456789abcdef01&ordax_reload=3#surface",
  );
});

test("native reload URL replaces prior retry marker instead of growing forever", () => {
  const url = buildReloadUrl(
    "http://127.0.0.1:8765/composition/native/index.html?source=old&ordax_reload=2",
    "0123456789012345678901234567890123456789",
    4,
  );
  assert.match(url, /source=0123456789012345678901234567890123456789/);
  assert.match(url, /ordax_reload=4/);
  assert.equal((url.match(/ordax_reload=/g) ?? []).length, 1);
});
