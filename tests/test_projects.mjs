import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_CATALOG_SCHEMA,
  validateProjectCatalogSnapshot,
  validateProjectEntry,
} from "../system/contracts/project-catalog.mjs";
import {
  PROJECT_STORE_SCHEMA,
  createEmptyProjectStoreState,
  validateProjectStoreState,
} from "../system/contracts/project-store.mjs";
import { createNativeProjectStore } from "../system/adapters/native/projects.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";

function memoryStore({ scope = "device", failSave = false, onSave = null } = {}) {
  let state = createEmptyProjectStoreState();
  return {
    schema: PROJECT_STORE_SCHEMA,
    scope,
    load() {
      return state;
    },
    save(next) {
      state = validateProjectStoreState(next);
      onSave?.(state);
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

test("project catalog contract rejects root paths, duplicates and malformed timestamps", () => {
  assert.throws(
    () => validateProjectEntry({
      id: "project-1",
      name: "Raiz",
      path: "/",
      createdAt: 1,
      lastOpenedAt: 1,
    }),
    /below the logical root/,
  );
  assert.throws(
    () => validateProjectCatalogSnapshot({
      persistence: "device",
      projects: [
        { id: "project-1", name: "A", path: "/A", createdAt: 1, lastOpenedAt: 1 },
        { id: "project-2", name: "B", path: "/A", createdAt: 2, lastOpenedAt: 2 },
      ],
    }),
    /unique logical paths/,
  );
  assert.throws(
    () => validateProjectEntry({
      id: "project-1",
      name: "A",
      path: "/A",
      createdAt: 5,
      lastOpenedAt: 4,
    }),
    /cannot precede/,
  );
});

test("project runtime creates stable ids, records successful opens and never reuses ids", () => {
  let clock = 10;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore(),
    now: () => clock++,
  });

  assert.equal(runtime.schema, PROJECT_CATALOG_SCHEMA);
  runtime.create({ name: "  Cliente A  ", path: "/Documentos/Cliente-A" });
  runtime.create({ name: "Cliente B", path: "/Documentos/Cliente-B" });
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.deepEqual(snapshot.projects.map((project) => project.id), ["project-2", "project-1"]);
  assert.equal(snapshot.projects[1].name, "Cliente A");

  runtime.recordOpened("project-1");
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.projects[0].id, "project-1");
  assert.equal(snapshot.projects[0].lastOpenedAt, 12);

  runtime.remove("project-1");
  runtime.create({ name: "Cliente C", path: "/Documentos/Cliente-C" });
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.projects[0].id, "project-3");
  assert.equal(snapshot.projects.some((project) => project.id === "project-1"), false);
});

test("renaming a project changes only its validated display name and preserves identity, path, activity and order", () => {
  let clock = 100;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore(),
    now: () => clock++,
  });
  runtime.create({ name: "Projeto A", path: "/Documentos/A" });
  runtime.create({ name: "Projeto B", path: "/Documentos/B" });
  const before = runtime.getSnapshot();
  const target = before.projects[1];

  const after = runtime.rename(target.id, "  Cliente principal  ");
  assert.equal(after.projects[1].name, "Cliente principal");
  assert.equal(after.projects[1].id, target.id);
  assert.equal(after.projects[1].path, target.path);
  assert.equal(after.projects[1].createdAt, target.createdAt);
  assert.equal(after.projects[1].lastOpenedAt, target.lastOpenedAt);
  assert.deepEqual(after.projects.map((project) => project.id), before.projects.map((project) => project.id));
  assert.equal(after.persistence, "device");
});

test("rename validates before mutation and no-op rename does not persist or emit", () => {
  let saves = 0;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ onSave: () => { saves += 1; } }),
    now: () => 200,
  });
  runtime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  assert.equal(saves, 1);
  const before = runtime.getSnapshot();
  let emissions = 0;
  const unsubscribe = runtime.subscribe(() => { emissions += 1; });

  const unchanged = runtime.rename("project-1", "  Projeto  ");
  assert.deepEqual(unchanged, before);
  assert.equal(saves, 1);
  assert.equal(emissions, 0);

  assert.throws(() => runtime.rename("project-99", "Outro"), /not registered/);
  assert.throws(() => runtime.rename("project-1", "   "), /bounded visible string/);
  assert.deepEqual(runtime.getSnapshot(), before);
  assert.equal(saves, 1);
  assert.equal(emissions, 0);
  unsubscribe();
});

test("rename persistence failure degrades to session while preserving the renamed project in memory", () => {
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ failSave: true }),
    now: () => 300,
  });
  runtime.create({ name: "Antes", path: "/Documentos/Local" });
  const snapshot = runtime.rename("project-1", "Depois");
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.projects[0].name, "Depois");
  assert.equal(snapshot.projects[0].path, "/Documentos/Local");
});

test("project runtime rejects duplicate folders without changing the catalog", () => {
  const runtime = createProjectCatalogRuntime({ store: memoryStore(), now: () => 100 });
  runtime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  const before = runtime.getSnapshot();
  assert.throws(
    () => runtime.create({ name: "Outro nome", path: "/Documentos/Projeto" }),
    /already registered/,
  );
  assert.deepEqual(runtime.getSnapshot(), before);
});

test("project persistence failure degrades to session while preserving in-memory state", () => {
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ failSave: true }),
    now: () => 7,
  });
  runtime.create({ name: "Local", path: "/Documentos/Local" });
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].path, "/Documentos/Local");
});

test("native project store survives recreation and fails closed on corrupt records", () => {
  const windowRef = localStorageWindow();
  const first = createNativeProjectStore(windowRef);
  first.save({
    nextOrdinal: 2,
    projects: [
      {
        id: "project-1",
        name: "Persistido",
        path: "/Documentos/Persistido",
        createdAt: 1,
        lastOpenedAt: 2,
      },
    ],
  });

  const second = createNativeProjectStore(windowRef);
  assert.equal(second.scope, "device");
  assert.equal(second.load().projects[0].name, "Persistido");

  windowRef.values.set("ordax.native.projects.v1", "{not-json");
  const corrupt = createNativeProjectStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyProjectStoreState());
});

test("native project store is explicitly session-scoped when browser storage is denied", () => {
  const windowRef = {};
  Object.defineProperty(windowRef, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const store = createNativeProjectStore(windowRef);
  assert.equal(store.scope, "session");
  assert.equal(store.save(createEmptyProjectStoreState()), false);
});
