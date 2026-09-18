import assert from "node:assert/strict";
import test from "node:test";

import {
  UPDATE_HISTORY_SCHEMA,
  assertUpdateHistoryPort,
  validateUpdateHistorySnapshot,
} from "../system/contracts/update-history.mjs";

const sha = "a".repeat(40);

test("update history validates releases and local applications", () => {
  const snapshot = validateUpdateHistorySnapshot({
    releases: [
      { deliveryNumber: 123, sourceSha: sha, releasedAt: "2026-09-18T11:34:15Z", title: "Rede nativa somente leitura" },
    ],
    applications: [
      {
        deliveryNumber: 123,
        sourceSha: sha,
        appliedAt: "2026-09-18T11:34:47Z",
        applyMode: "surface-restart",
        result: "applied",
        applyDurationSeconds: 27,
        stageDurationSeconds: 2,
      },
    ],
  });
  assert.equal(snapshot.releases[0].deliveryNumber, 123);
  assert.equal(snapshot.releases[0].versionNumber, 123);
  assert.equal(snapshot.applications[0].applyDurationSeconds, 27);
  assert.ok(Object.isFrozen(snapshot));
});

test("update history rejects unsafe or unbounded records", () => {
  assert.throws(() => validateUpdateHistorySnapshot({
    releases: [{ deliveryNumber: 0, sourceSha: sha, releasedAt: "x", title: "bad" }],
    applications: [],
  }));
  assert.throws(() => validateUpdateHistorySnapshot({
    releases: [],
    applications: [{
      versionNumber: 1,
      sourceSha: "bad",
      appliedAt: "x",
      applyMode: "reload",
      result: "applied",
      applyDurationSeconds: 1,
      stageDurationSeconds: 0,
    }],
  }));
});

test("update history port remains read-only", () => {
  const port = { schema: UPDATE_HISTORY_SCHEMA, async list() { return { releases: [], applications: [] }; } };
  assert.equal(assertUpdateHistoryPort(port), port);
  assert.equal("append" in port, false);
  assert.equal("clear" in port, false);
});
