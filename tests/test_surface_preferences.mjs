import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferenceSnapshot,
  listPreferenceDefinitions,
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
  assert.equal(first.save(createPreferenceSnapshot({ "appearance.theme": "dark" })), true);

  const second = createWebPreferenceStore(windowRef);
  assert.deepEqual(second.load(), {
    "appearance.theme": "dark",
    "accessibility.contrast": "standard",
    "accessibility.motion": "standard",
    "accessibility.text-scale": "standard",
  });
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
  const snapshot = createPreferenceSnapshot({ "appearance.theme": "dark" });
  assert.equal(store.save(snapshot), false);
  assert.deepEqual(store.load(), {
    "appearance.theme": "dark",
    "accessibility.contrast": "standard",
    "accessibility.motion": "standard",
    "accessibility.text-scale": "standard",
  });
});

test("persisted invalid known values recover to safe defaults", () => {
  assert.deepEqual(
    recoverPreferenceSnapshot({ "appearance.theme": "sepia" }),
    {
      "appearance.theme": "light",
      "accessibility.contrast": "standard",
      "accessibility.motion": "standard",
      "accessibility.text-scale": "standard",
    },
  );
});

test("runtime preference mutation still rejects unsupported values", () => {
  assert.throws(
    () => createPreferenceSnapshot({ "appearance.theme": "sepia" }),
    /Unsupported appearance theme/,
  );
});


test("accessibility preferences are first-class persisted definitions", () => {
  const definitions = new Map(
    listPreferenceDefinitions().map((definition) => [definition.id, definition]),
  );
  assert.equal(definitions.get("appearance.theme")?.sectionId, "appearance");
  assert.equal(definitions.get("accessibility.contrast")?.sectionId, "accessibility");
  assert.equal(definitions.get("accessibility.motion")?.sectionId, "accessibility");
  assert.equal(definitions.get("accessibility.text-scale")?.sectionId, "accessibility");

  assert.deepEqual(
    createPreferenceSnapshot({
      "accessibility.contrast": "high",
      "accessibility.motion": "reduced",
      "accessibility.text-scale": "extra-large",
    }),
    {
      "appearance.theme": "light",
      "accessibility.contrast": "high",
      "accessibility.motion": "reduced",
      "accessibility.text-scale": "extra-large",
    },
  );
});

test("invalid accessibility values recover or reject through the shared catalog", () => {
  assert.deepEqual(
    recoverPreferenceSnapshot({
      "accessibility.contrast": "impossible",
      "accessibility.motion": "unknown",
      "accessibility.text-scale": "huge",
    }),
    {
      "appearance.theme": "light",
      "accessibility.contrast": "standard",
      "accessibility.motion": "standard",
      "accessibility.text-scale": "standard",
    },
  );
  assert.throws(
    () => createPreferenceSnapshot({ "accessibility.motion": "unknown" }),
    /Unsupported accessibility\.motion/,
  );
  assert.throws(
    () => createPreferenceSnapshot({ "accessibility.text-scale": "huge" }),
    /Unsupported accessibility\.text-scale/,
  );
});
