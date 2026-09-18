import assert from "node:assert/strict";
import test from "node:test";

import {
  POWER_STATUS_SCHEMA,
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../system/contracts/power-status.mjs";

test("power status validates bounded battery state", () => {
  const snapshot = validatePowerStatusSnapshot({
    battery: { percent: 83, state: "discharging", serial: "must-not-cross" },
    externalPower: false,
    model: "must-not-cross",
  });
  assert.deepEqual(snapshot, {
    battery: { percent: 83, state: "discharging" },
    externalPower: false,
  });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.battery));
});

test("power status supports hosts without a battery", () => {
  assert.deepEqual(
    validatePowerStatusSnapshot({ battery: null, externalPower: null }),
    { battery: null, externalPower: null },
  );
});

test("power status rejects invalid percent and state", () => {
  assert.throws(() =>
    validatePowerStatusSnapshot({
      battery: { percent: 101, state: "charging" },
      externalPower: true,
    }),
  );
  assert.throws(() =>
    validatePowerStatusSnapshot({
      battery: { percent: 50, state: "exploding" },
      externalPower: true,
    }),
  );
});

test("power status port remains read-only", () => {
  const port = {
    schema: POWER_STATUS_SCHEMA,
    async read() {
      return { battery: null, externalPower: null };
    },
  };
  assert.equal(assertPowerStatusPort(port), port);
  assert.equal("set" in port, false);
  assert.equal("charge" in port, false);
});
