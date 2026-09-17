import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeUpdateWatcher,
  shouldReloadForUpdate,
} from "../system/adapters/native/update-runtime.mjs";

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("reload is requested only for a new source SHA classified as reload", () => {
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
  assert.equal(
    shouldReloadForUpdate("aaa", { sourceSha: "bbb", applyMode: "none" }),
    false,
  );
});

test("native watcher turns a live-safe update into one page reload", async () => {
  const responses = [
    { sourceSha: "aaa", applyMode: "initial", status: "running" },
    { sourceSha: "bbb", applyMode: "reload", status: "applied" },
  ];
  let scheduled = null;
  let reloads = 0;
  const states = [];

  const windowRef = {
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

  const watcher = createNativeUpdateWatcher(windowRef, {
    intervalMs: 1,
    onState: (state) => states.push(state),
  });
  await flushAsyncWork();
  assert.equal(watcher.getObservedSha(), "aaa");
  assert.equal(reloads, 0);
  assert.equal(typeof scheduled, "function");

  scheduled();
  await flushAsyncWork();
  assert.equal(watcher.getObservedSha(), "bbb");
  assert.equal(reloads, 1);
  assert.equal(states.length, 2);
  watcher.dispose();
});

test("host restart classifications update the observed SHA without page reload", async () => {
  const responses = [
    { sourceSha: "aaa", applyMode: "initial", status: "running" },
    { sourceSha: "bbb", applyMode: "surface-restart", status: "restarting" },
  ];
  let scheduled = null;
  let reloads = 0;

  const windowRef = {
    fetch: async () => ({ ok: true, json: async () => responses.shift() }),
    location: { reload: () => { reloads += 1; } },
    setTimeout(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimeout() {},
  };

  const watcher = createNativeUpdateWatcher(windowRef, { intervalMs: 1 });
  await flushAsyncWork();
  scheduled();
  await flushAsyncWork();

  assert.equal(watcher.getObservedSha(), "bbb");
  assert.equal(reloads, 0);
  watcher.dispose();
});
