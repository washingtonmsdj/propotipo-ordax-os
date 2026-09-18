import test from "node:test";
import assert from "node:assert/strict";

import {
  POWER_ACTIONS_SCHEMA,
  assertPowerActionsPort,
  isPowerActionSupported,
  validatePowerActionsSnapshot,
} from "../system/contracts/power-actions.mjs";
import { createNativePowerActions } from "../system/adapters/native/power-actions.mjs";
import {
  createNativeUpdateWatcher,
  shouldReloadForUpdate,
} from "../system/adapters/native/update-runtime.mjs";

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

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

test("native update policy reloads only a new live-safe source SHA", () => {
  assert.equal(
    shouldReloadForUpdate("aaa", { sourceSha: "bbb", applyMode: "reload" }),
    true,
  );
  assert.equal(
    shouldReloadForUpdate("aaa", { sourceSha: "aaa", applyMode: "reload" }),
    false,
  );
  assert.equal(
    shouldReloadForUpdate("aaa", { sourceSha: "bbb", applyMode: "surface-restart" }),
    false,
  );
});

test("native update watcher turns a live-safe Git update into one page reload", async () => {
  const responses = [
    { sourceSha: "aaa", applyMode: "initial", status: "running" },
    { sourceSha: "bbb", applyMode: "reload", status: "applied" },
  ];
  let scheduled = null;
  let reloads = 0;

  const fakeWindow = {
    fetch: async () => ({
      ok: true,
      json: async () => responses.shift(),
    }),
    location: {
      reload() {
        reloads += 1;
      },
    },
    setTimeout(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimeout() {},
  };

  const watcher = createNativeUpdateWatcher(fakeWindow, { intervalMs: 1 });
  await flushAsyncWork();
  assert.equal(watcher.getObservedSha(), "aaa");
  assert.equal(reloads, 0);

  scheduled();
  await flushAsyncWork();
  assert.equal(watcher.getObservedSha(), "bbb");
  assert.equal(reloads, 1);
  watcher.dispose();
});

test("old Surface never acknowledges the new SHA before reload", async () => {
  const updates = [
    { sourceSha: "aaa", applyMode: "initial", status: "running", healthToken: "token-aaa" },
    { sourceSha: "bbb", applyMode: "reload", status: "applied", healthToken: "token-bbb" },
  ];
  const healthPosts = [];
  let scheduled = null;
  let reloads = 0;

  const fakeWindow = {
    async fetch(url, options = {}) {
      if (url === "/__ordax/native/update") {
        return { ok: true, json: async () => updates.shift() };
      }
      if (url === "/__ordax/native/health") {
        healthPosts.push(JSON.parse(options.body));
        return { ok: true, status: 204 };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    location: { reload: () => { reloads += 1; } },
    setTimeout(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimeout() {},
  };

  const watcher = createNativeUpdateWatcher(fakeWindow, { intervalMs: 1 });
  await flushAsyncWork();
  await watcher.markHealthy();
  assert.deepEqual(healthPosts, [{ sourceSha: "aaa" }]);

  scheduled();
  await flushAsyncWork();
  await flushAsyncWork();

  assert.equal(reloads, 1);
  assert.deepEqual(healthPosts, [{ sourceSha: "aaa" }]);
  watcher.dispose();
});

test("native watcher leaves host-restart updates to the system supervisor", async () => {
  const responses = [
    { sourceSha: "aaa", applyMode: "initial", status: "running" },
    { sourceSha: "bbb", applyMode: "surface-restart", status: "restarting" },
  ];
  let scheduled = null;
  let reloads = 0;

  const fakeWindow = {
    fetch: async () => ({ ok: true, json: async () => responses.shift() }),
    location: { reload: () => { reloads += 1; } },
    setTimeout(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimeout() {},
  };

  const watcher = createNativeUpdateWatcher(fakeWindow, { intervalMs: 1 });
  await flushAsyncWork();
  scheduled();
  await flushAsyncWork();

  assert.equal(watcher.getObservedSha(), "bbb");
  assert.equal(reloads, 0);
  watcher.dispose();
});
