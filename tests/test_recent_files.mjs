import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECENT_FILES,
  validateRecentFilesSnapshot,
} from "../system/contracts/recent-files.mjs";
import { RECENT_FILES_STORE_SCHEMA } from "../system/contracts/recent-files-store.mjs";
import { createNativeRecentFilesStore } from "../system/adapters/native/recent-files.mjs";
import { createRecentFilesRuntime } from "../system/services/files/recent-files.mjs";

function createMemoryStorage() {
  const records = new Map();
  return {
    getItem(key) {
      return records.has(String(key)) ? records.get(String(key)) : null;
    },
    setItem(key, value) {
      records.set(String(key), String(value));
    },
    removeItem(key) {
      records.delete(String(key));
    },
  };
}

function createStore({ scope = "device", initial = [], saveResult = true } = {}) {
  let entries = initial;
  return {
    schema: RECENT_FILES_STORE_SCHEMA,
    scope,
    load() {
      return entries;
    },
    save(next) {
      entries = next;
      return saveResult;
    },
    read() {
      return entries;
    },
  };
}

test("recent-files contract rejects roots, duplicates and invalid persistence", () => {
  assert.throws(
    () => validateRecentFilesSnapshot({ persistence: "device", entries: [{ path: "/", name: "", openedAt: 1 }] }),
    /must identify a file/,
  );
  assert.throws(
    () => validateRecentFilesSnapshot({
      persistence: "device",
      entries: [
        { path: "/Docs/a.txt", name: "a.txt", openedAt: 2 },
        { path: "/Docs/a.txt", name: "a.txt", openedAt: 1 },
      ],
    }),
    /unique logical paths/,
  );
  assert.throws(
    () => validateRecentFilesSnapshot({ persistence: "cloud", entries: [] }),
    /device or session/,
  );
});

test("runtime records successful opens newest-first with bounded deduplication", () => {
  let clock = 1_000;
  const store = createStore();
  const runtime = createRecentFilesRuntime({ store, now: () => clock++ });

  for (let index = 0; index < MAX_RECENT_FILES + 1; index += 1) {
    runtime.recordOpened(`/Documentos/file-${index}.txt`);
  }

  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.equal(snapshot.entries.length, MAX_RECENT_FILES);
  assert.equal(snapshot.entries[0].path, `/Documentos/file-${MAX_RECENT_FILES}.txt`);
  assert.equal(snapshot.entries.at(-1).path, "/Documentos/file-1.txt");
  assert.equal(snapshot.entries.some((entry) => entry.path === "/Documentos/file-0.txt"), false);

  runtime.recordOpened("/Documentos/file-10.txt");
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.entries.length, MAX_RECENT_FILES);
  assert.equal(snapshot.entries[0].path, "/Documentos/file-10.txt");
  assert.equal(snapshot.entries.filter((entry) => entry.path === "/Documentos/file-10.txt").length, 1);
  assert.deepEqual(store.read(), snapshot.entries);
});

test("runtime relocates recent descendants and history removal never touches file-space", () => {
  let clock = 2_000;
  const runtime = createRecentFilesRuntime({ now: () => clock++ });
  runtime.recordOpened("/Documentos/Projeto/nota.txt");
  runtime.recordOpened("/Documentos/Projeto/sub/tarefa.txt");
  runtime.recordOpened("/Documentos/fora.txt");

  runtime.relocate("/Documentos/Projeto", "/Arquivo/Projeto");
  let snapshot = runtime.getSnapshot();
  assert.deepEqual(
    snapshot.entries.map((entry) => entry.path),
    [
      "/Documentos/fora.txt",
      "/Arquivo/Projeto/sub/tarefa.txt",
      "/Arquivo/Projeto/nota.txt",
    ],
  );

  runtime.remove("/Arquivo/Projeto/nota.txt");
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.entries.some((entry) => entry.path.endsWith("/nota.txt")), false);
  assert.equal(snapshot.entries.length, 2);

  runtime.clear();
  assert.deepEqual(runtime.getSnapshot().entries, []);
});

test("device persistence failure degrades to session without losing in-memory history", () => {
  const store = createStore({ saveResult: false });
  const runtime = createRecentFilesRuntime({ store, now: () => 3_000 });
  runtime.recordOpened("/Downloads/offline.txt");

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].path, "/Downloads/offline.txt");
});

test("Native recent-files store survives recreation and fails closed on corrupt records", () => {
  const storage = createMemoryStorage();
  const windowRef = { localStorage: storage };
  const first = createRecentFilesRuntime({
    store: createNativeRecentFilesStore(windowRef),
    now: () => 4_000,
  });
  first.recordOpened("/Documentos/persistente.txt");
  assert.equal(first.getSnapshot().persistence, "device");

  const second = createRecentFilesRuntime({
    store: createNativeRecentFilesStore(windowRef),
    now: () => 5_000,
  });
  assert.deepEqual(
    second.getSnapshot().entries.map((entry) => entry.path),
    ["/Documentos/persistente.txt"],
  );

  storage.setItem("ordax.native.recent-files.v1", "not-json");
  const recovered = createRecentFilesRuntime({
    store: createNativeRecentFilesStore(windowRef),
  });
  assert.equal(recovered.getSnapshot().persistence, "device");
  assert.deepEqual(recovered.getSnapshot().entries, []);
});

test("Native recent-files store is explicitly session-scoped when browser storage is denied", () => {
  const windowRef = {};
  Object.defineProperty(windowRef, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const runtime = createRecentFilesRuntime({
    store: createNativeRecentFilesStore(windowRef),
    now: () => 6_000,
  });
  runtime.recordOpened("/Imagens/session.txt");

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.deepEqual(snapshot.entries.map((entry) => entry.path), ["/Imagens/session.txt"]);
});
