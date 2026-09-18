import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UPDATE_STATE_MAX_AGE_SECONDS,
  MAX_UPDATE_STATE_MAX_AGE_SECONDS,
  UPDATE_CLOCK_SKEW_TOLERANCE_SECONDS,
  evaluateUpdateStateFreshness,
  validateUpdateStateMaxAgeSeconds,
} from "../system/services/update/freshness.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const NOW_MS = Date.parse("2026-09-18T22:30:00Z");

function updateSnapshot(overrides = {}) {
  return {
    sourceSha: SOURCE_SHA,
    status: "running",
    phase: "idle",
    applyMode: "none",
    checkedAt: "2026-09-18T22:29:30Z",
    ...overrides,
  };
}

test("freshness is based on observation age, never on a positive update status", () => {
  const fresh = evaluateUpdateStateFreshness(updateSnapshot(), { nowMs: NOW_MS });
  assert.equal(fresh.state, "fresh");
  assert.equal(fresh.ageSeconds, 30);
  assert.equal(fresh.maxAgeSeconds, DEFAULT_UPDATE_STATE_MAX_AGE_SECONDS);
  assert.equal(fresh.reason, "");

  const stale = evaluateUpdateStateFreshness(
    updateSnapshot({
      status: "running",
      checkedAt: "2026-09-18T22:27:00Z",
    }),
    { nowMs: NOW_MS },
  );
  assert.equal(stale.state, "stale");
  assert.equal(stale.ageSeconds, 180);
  assert.equal(stale.reason, "");
});

test("freshness boundary is explicit and caller policy can be stricter or looser", () => {
  const atBoundary = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "2026-09-18T22:28:30Z" }),
    { nowMs: NOW_MS, maxAgeSeconds: 90 },
  );
  assert.equal(atBoundary.state, "fresh");
  assert.equal(atBoundary.ageSeconds, 90);

  const stricter = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "2026-09-18T22:29:30Z" }),
    { nowMs: NOW_MS, maxAgeSeconds: 20 },
  );
  assert.equal(stricter.state, "stale");

  const looser = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "2026-09-18T22:27:00Z" }),
    { nowMs: NOW_MS, maxAgeSeconds: 300 },
  );
  assert.equal(looser.state, "fresh");
});

test("missing, malformed or clearly future checkedAt remains unknown", () => {
  const missing = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "unknown" }),
    { nowMs: NOW_MS },
  );
  assert.deepEqual(missing, {
    state: "unknown",
    reason: "missing-checked-at",
    checkedAt: null,
    ageSeconds: null,
    maxAgeSeconds: 90,
  });

  const malformed = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "not-a-date" }),
    { nowMs: NOW_MS },
  );
  assert.equal(malformed.state, "unknown");
  assert.equal(malformed.reason, "invalid-checked-at");

  const future = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "2026-09-18T22:30:06Z" }),
    { nowMs: NOW_MS },
  );
  assert.equal(future.state, "unknown");
  assert.equal(future.reason, "clock-skew");
});

test("small clock skew is tolerated without producing a negative age", () => {
  const withinTolerance = evaluateUpdateStateFreshness(
    updateSnapshot({ checkedAt: "2026-09-18T22:30:05Z" }),
    { nowMs: NOW_MS },
  );
  assert.equal(UPDATE_CLOCK_SKEW_TOLERANCE_SECONDS, 5);
  assert.equal(withinTolerance.state, "fresh");
  assert.equal(withinTolerance.ageSeconds, 0);
});

test("freshness policy bounds are fail closed", () => {
  assert.equal(validateUpdateStateMaxAgeSeconds(1), 1);
  assert.equal(
    validateUpdateStateMaxAgeSeconds(MAX_UPDATE_STATE_MAX_AGE_SECONDS),
    MAX_UPDATE_STATE_MAX_AGE_SECONDS,
  );
  for (const invalid of [0, -1, 1.5, MAX_UPDATE_STATE_MAX_AGE_SECONDS + 1, Infinity]) {
    assert.throws(() => validateUpdateStateMaxAgeSeconds(invalid), TypeError);
  }
  assert.throws(
    () => evaluateUpdateStateFreshness(updateSnapshot(), { nowMs: -1 }),
    TypeError,
  );
});

test("freshness result is immutable", () => {
  const result = evaluateUpdateStateFreshness(updateSnapshot(), { nowMs: NOW_MS });
  assert.ok(Object.isFrozen(result));
});
