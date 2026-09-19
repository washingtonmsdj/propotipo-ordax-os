import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_HISTORY_SCHEMA,
  MAX_BROWSER_HISTORY_ENTRIES,
  validateBrowserHistorySnapshot,
} from "../system/contracts/browser-history.mjs";
import {
  BROWSER_HISTORY_STORE_SCHEMA,
  createEmptyBrowserHistoryStoreState,
  validateBrowserHistoryStoreState,
} from "../system/contracts/browser-history-store.mjs";
import { createNativeBrowserHistoryStore } from "../system/adapters/native/browser-history.mjs";
import { createBrowserHistoryBridge } from "../system/services/internet/history-bridge.mjs";
import { createBrowserHistoryRuntime } from "../system/services/internet/history.mjs";
import {
  BROWSER_SESSION_SCHEMA,
  validateBrowserSnapshot,
} from "../system/contracts/browser-session.mjs";

function historyStore({ scope = "device", failSave = false } = {}) {
  let state = createEmptyBrowserHistoryStoreState();
  return {
    schema: BROWSER_HISTORY_STORE_SCHEMA,
    scope,
    load() {
      return state;
    },
    save(next) {
      state = validateBrowserHistoryStoreState(next);
      return !failSave;
    },
  };
}

function localStorageWindow() {
  const values = new Map();
  return {
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    },
    values,
  };
}

function browserSession(initial) {
  let snapshot = validateBrowserSnapshot(initial);
  const listeners = new Set();
  const noop = () => false;
  return {
    schema: BROWSER_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeShortcuts() {
      return () => {};
    },
    openTab: noop,
    closeTab: noop,
    activateTab: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    setViewport: noop,
    dispose() {},
    emit(next) {
      snapshot = validateBrowserSnapshot(next);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function browserSnapshot(tabs, activeTabId = tabs[0]?.id ?? null) {
  return {
    supported: true,
    reason: "",
    activeTabId,
    tabs,
  };
}

function tab(id, url, { title = "Página", loading = false } = {}) {
  return {
    id,
    url,
    title,
    loading,
    canGoBack: false,
    canGoForward: false,
  };
}

test("browser history records canonical visits newest first with monotonic ids", () => {
  let clock = 100;
  const runtime = createBrowserHistoryRuntime({
    store: historyStore(),
    now: () => clock++,
  });

  assert.equal(runtime.schema, BROWSER_HISTORY_SCHEMA);
  runtime.record({ url: "https://EXAMPLE.org/docs", title: "Documentação" });
  runtime.record({ url: "https://example.org/about", title: "Sobre" });

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ["history-2", "history-1"]);
  assert.equal(snapshot.entries[1].url, "https://example.org/docs");
  assert.equal(snapshot.entries[0].visitedAt, 101);
});

test("browser history is rolling, bounded, removable and clear keeps ordinal monotonic", () => {
  let clock = 1000;
  const runtime = createBrowserHistoryRuntime({
    store: historyStore(),
    now: () => clock++,
  });

  for (let index = 0; index < MAX_BROWSER_HISTORY_ENTRIES + 2; index += 1) {
    runtime.record({
      url: `https://example.org/page/${index}`,
      title: `Page ${index}`,
    });
  }

  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.entries.length, MAX_BROWSER_HISTORY_ENTRIES);
  assert.equal(snapshot.entries[0].id, `history-${MAX_BROWSER_HISTORY_ENTRIES + 2}`);
  assert.equal(snapshot.entries.at(-1).id, "history-3");

  runtime.remove(snapshot.entries[0].id);
  assert.equal(runtime.getSnapshot().entries.length, MAX_BROWSER_HISTORY_ENTRIES - 1);
  runtime.clear();
  assert.equal(runtime.getSnapshot().entries.length, 0);

  runtime.record({ url: "https://example.org/fresh", title: "Fresh" });
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.entries[0].id, `history-${MAX_BROWSER_HISTORY_ENTRIES + 3}`);
});

test("history rejects unsafe URLs before mutation and falls back to host title", () => {
  const runtime = createBrowserHistoryRuntime({
    store: historyStore(),
    now: () => 2000,
  });

  assert.throws(
    () => runtime.record({ url: "javascript:alert(1)", title: "Unsafe" }),
    /http or https/,
  );
  assert.throws(
    () => runtime.record({ url: "https://user:secret@example.org/", title: "Unsafe" }),
    /credentials or host/,
  );
  assert.equal(runtime.getSnapshot().entries.length, 0);

  runtime.record({ url: "https://example.org/docs", title: "" });
  assert.equal(runtime.getSnapshot().entries[0].title, "example.org");
});

test("persistence failure degrades history to session without losing visit", () => {
  const runtime = createBrowserHistoryRuntime({
    store: historyStore({ failSave: true }),
    now: () => 3000,
  });
  const snapshot = runtime.record({
    url: "https://example.org/",
    title: "Example",
  });
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.entries.length, 1);
});

test("native history store survives recreation and rejects corrupt records", () => {
  const windowRef = localStorageWindow();
  const store = createNativeBrowserHistoryStore(windowRef);
  store.save({
    nextOrdinal: 2,
    entries: [{
      id: "history-1",
      url: "https://example.org/",
      title: "Example",
      visitedAt: 1,
    }],
  });

  const restored = createNativeBrowserHistoryStore(windowRef);
  assert.equal(restored.scope, "device");
  assert.equal(restored.load().entries[0].url, "https://example.org/");

  windowRef.values.set("ordax.native.browser-history.v1", "{broken");
  const corrupt = createNativeBrowserHistoryStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyBrowserHistoryStoreState());
});

test("history bridge ignores restored tabs and records only later completed URL transitions", () => {
  let clock = 4000;
  const history = createBrowserHistoryRuntime({
    store: historyStore(),
    now: () => clock++,
  });
  const session = browserSession(browserSnapshot([
    tab("tab-1", "https://restored.example/", { title: "Restored", loading: false }),
  ]));
  const bridge = createBrowserHistoryBridge(session, history);

  assert.equal(history.getSnapshot().entries.length, 0);

  session.emit(browserSnapshot([
    tab("tab-1", "https://new.example/", { title: "Loading", loading: true }),
  ]));
  assert.equal(history.getSnapshot().entries.length, 0);

  session.emit(browserSnapshot([
    tab("tab-1", "https://new.example/", { title: "New page", loading: false }),
  ]));
  assert.deepEqual(
    history.getSnapshot().entries.map((entry) => entry.url),
    ["https://new.example/"],
  );

  // Repeated state snapshots do not duplicate a visit.
  session.emit(browserSnapshot([
    tab("tab-1", "https://new.example/", { title: "New title", loading: false }),
  ]));
  assert.equal(history.getSnapshot().entries.length, 1);

  // Back/forward to a different completed URL is a new visit.
  session.emit(browserSnapshot([
    tab("tab-1", "https://restored.example/", { title: "Restored", loading: false }),
  ]));
  assert.deepEqual(
    history.getSnapshot().entries.map((entry) => entry.url),
    ["https://restored.example/", "https://new.example/"],
  );

  bridge.destroy();
});

test("history snapshot validation requires newest-first stable entries", () => {
  assert.throws(
    () => validateBrowserHistorySnapshot({
      persistence: "device",
      entries: [
        { id: "history-1", url: "https://one.example/", title: "One", visitedAt: 1 },
        { id: "history-2", url: "https://two.example/", title: "Two", visitedAt: 2 },
      ],
    }),
    /newest first/,
  );
});
