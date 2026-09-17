import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_STATUS_SCHEMA,
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../system/contracts/update-status.mjs";
import { createNativeUpdateWatcher } from "../system/adapters/native/update-runtime.mjs";

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
    location: { reload() {} },
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
  assert.equal(snapshot.checkedAt, "unknown");
  assert.equal(snapshot.lastAppliedSha, "");
  assert.equal(snapshot.rejectedSha, "");
  assert.equal(snapshot.healthToken, "");
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
