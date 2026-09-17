import test from "node:test";
import assert from "node:assert/strict";

import {
  POWER_ACTIONS_SCHEMA,
  assertPowerActionsPort,
  isPowerActionSupported,
  validatePowerActionsSnapshot,
} from "../system/contracts/power-actions.mjs";
import { createNativePowerActions } from "../system/adapters/native/power-actions.mjs";

test("power action contract normalizes supported actions", () => {
  const snapshot = validatePowerActionsSnapshot({ supportedActions: ["restart", "shutdown"] });
  assert.deepEqual(snapshot.supportedActions, ["restart", "shutdown"]);
  assert.equal(isPowerActionSupported(snapshot, "restart"), true);
  assert.equal(isPowerActionSupported(snapshot, "shutdown"), true);
});

test("power action contract rejects unknown and duplicate actions", () => {
  assert.throws(
    () => validatePowerActionsSnapshot({ supportedActions: ["restart", "restart"] }),
    TypeError,
  );
  assert.throws(
    () => validatePowerActionsSnapshot({ supportedActions: ["hibernate"] }),
    TypeError,
  );
});

test("power action port is schema checked", () => {
  const port = {
    schema: POWER_ACTIONS_SCHEMA,
    getSnapshot: () => ({ supportedActions: [] }),
    subscribe: () => () => {},
    execute: async () => {},
  };
  assert.equal(assertPowerActionsPort(port), port);
});

test("native power adapter acquires same-origin session and sends authenticated action", async () => {
  const requests = [];
  const fakeWindow = {
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (url === "/__ordax/native/session") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              token: "01234567890123456789012345678901",
              supportedActions: ["restart", "shutdown"],
            };
          },
        };
      }
      if (url === "/__ordax/native/power") {
        return { ok: true, status: 202 };
      }
      throw new Error(`unexpected URL ${url}`);
    },
  };

  const port = await createNativePowerActions(fakeWindow);
  assert.deepEqual(port.getSnapshot().supportedActions, ["restart", "shutdown"]);
  await port.execute("restart");

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "/__ordax/native/session");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[1].url, "/__ordax/native/power");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers["X-OrdaX-Power-Token"], "01234567890123456789012345678901");
  assert.deepEqual(JSON.parse(requests[1].options.body), { action: "restart" });
  await assert.rejects(() => port.execute("hibernate"), TypeError);
});
