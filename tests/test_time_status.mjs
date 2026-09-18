import assert from "node:assert/strict";
import test from "node:test";

import {
  TIME_STATUS_SCHEMA,
  assertTimeStatusPort,
  validateTimeStatusSnapshot,
} from "../system/contracts/time-status.mjs";

test("time status exposes only bounded automatic sync liveness", () => {
  const snapshot = validateTimeStatusSnapshot({
    automaticSync: "running",
    pid: 123,
    peer: "must-not-cross",
  });
  assert.deepEqual(snapshot, { automaticSync: "running" });
  assert.ok(Object.isFrozen(snapshot));
});

test("time status accepts unavailable and rejects invented states", () => {
  assert.deepEqual(
    validateTimeStatusSnapshot({ automaticSync: "unavailable" }),
    { automaticSync: "unavailable" },
  );
  assert.throws(() => validateTimeStatusSnapshot({ automaticSync: "synchronized" }));
});

test("time status port remains read-only", () => {
  const port = {
    schema: TIME_STATUS_SCHEMA,
    async read() {
      return { automaticSync: "running" };
    },
  };
  assert.equal(assertTimeStatusPort(port), port);
  assert.equal("setTime" in port, false);
  assert.equal("syncNow" in port, false);
});
