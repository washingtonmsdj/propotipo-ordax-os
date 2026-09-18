import assert from "node:assert/strict";
import test from "node:test";

import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { SYNC_RUNTIME_SCHEMA } from "../system/contracts/sync-runtime.mjs";
import {
  createAppearanceSyncObject,
  createSyncMutationQueue,
} from "../system/services/sync/runtime.mjs";
import { createPreferenceSyncRuntime } from "../system/services/sync/preference-runtime.mjs";

function createFakePreferenceRuntime(initialTheme = "light") {
  let snapshot = Object.freeze({ "appearance.theme": initialTheme });
  const listeners = new Set();

  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    setTheme(theme) {
      snapshot = Object.freeze({ "appearance.theme": theme });
      for (const listener of [...listeners]) listener(snapshot);
    },
    set() {
      throw new Error("test runtime uses setTheme()");
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

function createKeyFactory() {
  let ordinal = 0;
  return () => {
    ordinal += 1;
    return `pref:test:${String(ordinal).padStart(4, "0")}`;
  };
}

test("appearance sync object validates", () => {
  const object = createAppearanceSyncObject({ theme: "light", serverRevision: 7 });
  assert.equal(object.payload.theme, "light");
  assert.equal(object.serverRevision, 7);
});

test("offline mutation queue keeps idempotent appearance mutations", () => {
  const queue = createSyncMutationQueue();
  assert.deepEqual(queue.snapshot(), []);
});

test("preference sync runtime tracks live appearance changes without claiming cloud transport", () => {
  const preferences = createFakePreferenceRuntime();
  const sync = createPreferenceSyncRuntime(preferences, {
    createIdempotencyKey: createKeyFactory(),
  });

  assert.equal(sync.schema, SYNC_RUNTIME_SCHEMA);
  assert.deepEqual(sync.getSnapshot(), {
    transport: "host-required",
    accountContinuity: "not-active",
    pendingMutationCount: 0,
    trackedDataClasses: ["appearance"],
  });

  preferences.setTheme("dark");
  assert.equal(sync.getSnapshot().pendingMutationCount, 1);
  let pending = sync.pendingMutations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].payload.theme, "dark");
  assert.equal(pending[0].baseServerRevision, 0);

  preferences.setTheme("light");
  pending = sync.pendingMutations();
  assert.equal(pending.length, 1, "latest local appearance state compacts the pending object");
  assert.equal(pending[0].payload.theme, "light");

  const acknowledgedKey = pending[0].idempotencyKey;
  assert.equal(sync.acknowledge(acknowledgedKey, 9), true);
  assert.equal(sync.getSnapshot().pendingMutationCount, 0);

  preferences.setTheme("dark");
  pending = sync.pendingMutations();
  assert.equal(pending[0].baseServerRevision, 9);

  sync.destroy();
});
