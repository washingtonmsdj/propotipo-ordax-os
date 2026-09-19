import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_CATALOG_SCHEMA,
  validateProjectCatalogSnapshot,
  validateProjectEntry,
  validateProjectFilePath,
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

test("project file continuity is optional for old records and confined to the project folder", () => {
  const legacy = validateProjectEntry({
    id: "project-1",
    name: "Legado",
    path: "/Documentos/Legado",
    createdAt: 1,
    lastOpenedAt: 2,
  });
  assert.equal(legacy.lastFilePath, null);
  assert.equal(
    validateProjectFilePath("/Documentos/Legado", "/Documentos/Legado/roteiro.txt"),
    "/Documentos/Legado/roteiro.txt",
  );
  assert.throws(
    () => validateProjectFilePath("/Documentos/Legado", "/Documentos/Legado"),
    /inside the project folder/,
  );
  assert.throws(
    () => validateProjectFilePath("/Documentos/Legado", "/Documentos/Legado-2/roteiro.txt"),
    /inside the project folder/,
  );
  assert.throws(
    () => validateProjectFilePath("/Documentos/Legado", "/Downloads/roteiro.txt"),
    /inside the project folder/,
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
  assert.equal(snapshot.projects[1].lastFilePath, null);

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

test("recording an opened file preserves project identity and promotes real content continuity", () => {
  let clock = 20;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore(),
    now: () => clock++,
  });
  runtime.create({ name: "Projeto A", path: "/Documentos/A" });
  runtime.create({ name: "Projeto B", path: "/Documentos/B" });
  const before = runtime.getSnapshot();
  const projectA = before.projects.find((project) => project.path === "/Documentos/A");

  const after = runtime.recordFileOpened(projectA.id, "/Documentos/A/notas/roteiro.txt");
  assert.equal(after.projects[0].id, projectA.id);
  assert.equal(after.projects[0].name, projectA.name);
  assert.equal(after.projects[0].path, projectA.path);
  assert.equal(after.projects[0].createdAt, projectA.createdAt);
  assert.equal(after.projects[0].lastOpenedAt, 22);
  assert.equal(after.projects[0].lastFilePath, "/Documentos/A/notas/roteiro.txt");
  assert.equal(after.persistence, "device");

  const renamed = runtime.rename(projectA.id, "Projeto A renomeado");
  assert.equal(renamed.projects[0].lastFilePath, "/Documentos/A/notas/roteiro.txt");
});

test("recording project file context validates before clock, persistence or mutation", () => {
  let saves = 0;
  let clockReads = 0;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ onSave: () => { saves += 1; } }),
    now: () => {
      clockReads += 1;
      return 100 + clockReads;
    },
  });
  runtime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  const before = runtime.getSnapshot();
  assert.equal(saves, 1);
  assert.equal(clockReads, 1);

  assert.throws(
    () => runtime.recordFileOpened("project-1", "/Documentos/Outro/segredo.txt"),
    /inside the project folder/,
  );
  assert.throws(
    () => runtime.recordFileOpened("project-99", "/Documentos/Projeto/arquivo.txt"),
    /not registered/,
  );
  assert.deepEqual(runtime.getSnapshot(), before);
  assert.equal(saves, 1);
  assert.equal(clockReads, 1);
});

test("project file continuity persistence failure degrades to session without losing in-memory context", () => {
  let clock = 300;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ failSave: true }),
    now: () => clock++,
  });
  runtime.create({ name: "Local", path: "/Documentos/Local" });
  const snapshot = runtime.recordFileOpened("project-1", "/Documentos/Local/tarefa.txt");
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.projects[0].lastFilePath, "/Documentos/Local/tarefa.txt");
  assert.equal(snapshot.projects[0].lastOpenedAt, 301);
});

test("clearing last file removes only continuity reference without changing project activity or order", () => {
  let saves = 0;
  let emissions = 0;
  let clockReads = 0;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ onSave: () => { saves += 1; } }),
    now: () => {
      clockReads += 1;
      return 400 + clockReads;
    },
  });
  runtime.create({ name: "Projeto A", path: "/Documentos/A" });
  runtime.create({ name: "Projeto B", path: "/Documentos/B" });
  runtime.recordFileOpened("project-1", "/Documentos/A/contexto.txt");
  const before = runtime.getSnapshot();
  const beforeTarget = before.projects.find((project) => project.id === "project-1");
  const order = before.projects.map((project) => project.id);
  const savesBeforeClear = saves;
  const clockReadsBeforeClear = clockReads;
  const unsubscribe = runtime.subscribe(() => { emissions += 1; });

  const cleared = runtime.clearLastFile("project-1");
  const target = cleared.projects.find((project) => project.id === "project-1");
  assert.equal(target.lastFilePath, null);
  assert.equal(target.id, beforeTarget.id);
  assert.equal(target.name, beforeTarget.name);
  assert.equal(target.path, beforeTarget.path);
  assert.equal(target.createdAt, beforeTarget.createdAt);
  assert.equal(target.lastOpenedAt, beforeTarget.lastOpenedAt);
  assert.deepEqual(cleared.projects.map((project) => project.id), order);
  assert.equal(clockReads, clockReadsBeforeClear);
  assert.equal(saves, savesBeforeClear + 1);
  assert.equal(emissions, 1);

  const unchanged = runtime.clearLastFile("project-1");
  assert.deepEqual(unchanged, cleared);
  assert.equal(clockReads, clockReadsBeforeClear);
  assert.equal(saves, savesBeforeClear + 1);
  assert.equal(emissions, 1);

  assert.throws(() => runtime.clearLastFile("project-99"), /not registered/);
  assert.deepEqual(runtime.getSnapshot(), cleared);
  assert.equal(saves, savesBeforeClear + 1);
  assert.equal(emissions, 1);
  unsubscribe();
});

test("clearing last file degrades to session when persistence fails but keeps reference cleared", () => {
  let clock = 500;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ failSave: true }),
    now: () => clock++,
  });
  runtime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  runtime.recordFileOpened("project-1", "/Documentos/Projeto/antigo.txt");
  const before = runtime.getSnapshot().projects[0];
  const cleared = runtime.clearLastFile("project-1");
  assert.equal(cleared.persistence, "session");
  assert.equal(cleared.projects[0].lastFilePath, null);
  assert.equal(cleared.projects[0].lastOpenedAt, before.lastOpenedAt);
});

test("relocating a referenced file or ancestor folder preserves continuity without fabricating activity", () => {
  let saves = 0;
  let emissions = 0;
  let clockReads = 0;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ onSave: () => { saves += 1; } }),
    now: () => {
      clockReads += 1;
      return 600 + clockReads;
    },
  });
  runtime.create({ name: "Projeto A", path: "/Documentos/A" });
  runtime.create({ name: "Projeto B", path: "/Documentos/B" });
  runtime.recordFileOpened("project-1", "/Documentos/A/cenas/roteiro.txt");
  const before = runtime.getSnapshot();
  const beforeTarget = before.projects.find((project) => project.id === "project-1");
  const order = before.projects.map((project) => project.id);
  const savesBeforeRelocate = saves;
  const clockReadsBeforeRelocate = clockReads;
  const unsubscribe = runtime.subscribe(() => { emissions += 1; });

  const relocated = runtime.relocateLastFilePath(
    "/Documentos/A/cenas",
    "/Documentos/A/roteiros",
  );
  const target = relocated.projects.find((project) => project.id === "project-1");
  assert.equal(target.lastFilePath, "/Documentos/A/roteiros/roteiro.txt");
  assert.equal(target.lastOpenedAt, beforeTarget.lastOpenedAt);
  assert.equal(target.createdAt, beforeTarget.createdAt);
  assert.deepEqual(relocated.projects.map((project) => project.id), order);
  assert.equal(clockReads, clockReadsBeforeRelocate);
  assert.equal(saves, savesBeforeRelocate + 1);
  assert.equal(emissions, 1);

  const unchanged = runtime.relocateLastFilePath(
    "/Documentos/A/cenas",
    "/Documentos/A/roteiros",
  );
  assert.deepEqual(unchanged, relocated);
  assert.equal(saves, savesBeforeRelocate + 1);
  assert.equal(emissions, 1);
  unsubscribe();
});

test("moving referenced content outside its project clears only the source continuity", () => {
  let clock = 700;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore(),
    now: () => clock++,
  });
  runtime.create({ name: "Projeto A", path: "/Documentos/A" });
  runtime.create({ name: "Projeto B", path: "/Documentos/B" });
  runtime.recordFileOpened("project-1", "/Documentos/A/roteiro.txt");
  const before = runtime.getSnapshot();
  const projectA = before.projects.find((project) => project.id === "project-1");
  const projectB = before.projects.find((project) => project.id === "project-2");
  const order = before.projects.map((project) => project.id);

  const moved = runtime.relocateLastFilePath(
    "/Documentos/A/roteiro.txt",
    "/Documentos/B/roteiro.txt",
  );
  const afterA = moved.projects.find((project) => project.id === "project-1");
  const afterB = moved.projects.find((project) => project.id === "project-2");
  assert.equal(afterA.lastFilePath, null);
  assert.equal(afterA.lastOpenedAt, projectA.lastOpenedAt);
  assert.equal(afterB.lastFilePath, null);
  assert.equal(afterB.lastOpenedAt, projectB.lastOpenedAt);
  assert.deepEqual(moved.projects.map((project) => project.id), order);
});

test("project continuity relocation validates before mutation and degrades storage failure to session", () => {
  let saves = 0;
  const runtime = createProjectCatalogRuntime({
    store: memoryStore({ onSave: () => { saves += 1; } }),
    now: () => 800,
  });
  runtime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  runtime.recordFileOpened("project-1", "/Documentos/Projeto/original.txt");
  const before = runtime.getSnapshot();
  const savesBeforeInvalid = saves;

  assert.throws(
    () => runtime.relocateLastFilePath("/", "/Documentos/Projeto/novo.txt"),
    /below the logical root/,
  );
  assert.throws(
    () => runtime.relocateLastFilePath("/Documentos/Projeto/original.txt", "/"),
    /below the logical root/,
  );
  assert.deepEqual(runtime.getSnapshot(), before);
  assert.equal(saves, savesBeforeInvalid);

  const failingRuntime = createProjectCatalogRuntime({
    store: memoryStore({ failSave: true }),
    now: () => 900,
  });
  failingRuntime.create({ name: "Projeto", path: "/Documentos/Projeto" });
  failingRuntime.recordFileOpened("project-1", "/Documentos/Projeto/original.txt");
  const relocated = failingRuntime.relocateLastFilePath(
    "/Documentos/Projeto/original.txt",
    "/Documentos/Projeto/novo.txt",
  );
  assert.equal(relocated.persistence, "session");
  assert.equal(relocated.projects[0].lastFilePath, "/Documentos/Projeto/novo.txt");
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
  assert.equal(after.projects[1].lastFilePath, target.lastFilePath);
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

test("native project store accepts legacy records without file continuity and survives recreation", () => {
  const windowRef = localStorageWindow();
  windowRef.values.set(
    "ordax.native.projects.v1",
    JSON.stringify({
      schema: "ordax.native.projects-record/1",
      state: {
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
      },
    }),
  );

  const first = createNativeProjectStore(windowRef);
  const loaded = first.load();
  assert.equal(loaded.projects[0].name, "Persistido");
  assert.equal(loaded.projects[0].lastFilePath, null);
  first.save(loaded);

  const second = createNativeProjectStore(windowRef);
  assert.equal(second.scope, "device");
  assert.equal(second.load().projects[0].lastFilePath, null);

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