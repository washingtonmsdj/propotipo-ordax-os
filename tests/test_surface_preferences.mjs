import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferenceSnapshot,
  recoverPreferenceSnapshot,
} from "../system/services/preferences/catalog.mjs";
import { createWebPreferenceStore } from "../system/adapters/web/preferences.mjs";

class FakeStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("Web preference store survives a new adapter instance", () => {
  const storage = new FakeStorage();
  const windowRef = { localStorage: storage };
  const first = createWebPreferenceStore(windowRef);
  assert.deepEqual(first.load(), {});
  assert.equal(first.save(createPreferenceSnapshot({ "appearance.theme": "light" })), true);

  const second = createWebPreferenceStore(windowRef);
  assert.deepEqual(second.load(), { "appearance.theme": "light" });
});

test("corrupt browser storage falls back without inventing preferences", () => {
  const storage = new FakeStorage();
  storage.setItem("ordax.preferences.v1", "{not-json");
  const store = createWebPreferenceStore({ localStorage: storage });
  assert.deepEqual(store.load(), {});
});

test("denied browser storage degrades to session memory", () => {
  const windowRef = {};
  Object.defineProperty(windowRef, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const store = createWebPreferenceStore(windowRef);
  const snapshot = createPreferenceSnapshot({ "appearance.theme": "light" });
  assert.equal(store.save(snapshot), false);
  assert.deepEqual(store.load(), { "appearance.theme": "light" });
});

test("persisted invalid known values recover to safe defaults", () => {
  assert.deepEqual(
    recoverPreferenceSnapshot({ "appearance.theme": "sepia" }),
    { "appearance.theme": "dark" },
  );
});

test("runtime preference mutation still rejects unsupported values", () => {
  assert.throws(
    () => createPreferenceSnapshot({ "appearance.theme": "sepia" }),
    /Unsupported appearance theme/,
  );
});
