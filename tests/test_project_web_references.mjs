import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_WEB_REFERENCES_SCHEMA,
  validateProjectWebReferenceSnapshot,
} from "../system/contracts/project-web-references.mjs";
import {
  PROJECT_WEB_REFERENCE_STORE_SCHEMA,
  createEmptyProjectWebReferenceStoreState,
  validateProjectWebReferenceStoreState,
} from "../system/contracts/project-web-reference-store.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createProjectWebReferenceRuntime } from "../system/services/projects/web-references.mjs";
import { createNativeProjectWebReferenceStore } from "../system/adapters/native/project-web-references.mjs";

function referenceStore({ scope = "device", failSave = false } = {}) {
  let state = createEmptyProjectWebReferenceStoreState();
  return {
    schema: PROJECT_WEB_REFERENCE_STORE_SCHEMA,
    scope,
    load() {
      return state;
    },
    save(next) {
      state = validateProjectWebReferenceStoreState(next);
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

function projects() {
  const runtime = createProjectCatalogRuntime({ now: () => 10 });
  runtime.create({ name: "Pesquisa", path: "/Documentos/Pesquisa" });
  runtime.create({ name: "Produto", path: "/Documentos/Produto" });
  return runtime;
}

test("project web references save canonical URLs and update one project/url identity", () => {
  let clock = 100;
  const projectRuntime = projects();
  const runtime = createProjectWebReferenceRuntime({
    projects: projectRuntime,
    store: referenceStore(),
    now: () => clock++,
  });

  assert.equal(runtime.schema, PROJECT_WEB_REFERENCES_SCHEMA);
  runtime.save({
    projectId: "project-1",
    url: "https://EXAMPLE.org/espacos",
    title: "Espaços que inspiram",
    note: "Referência visual",
  });
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.equal(snapshot.references.length, 1);
  assert.deepEqual(snapshot.references[0], {
    id: "project-ref-1",
    projectId: "project-1",
    url: "https://example.org/espacos",
    title: "Espaços que inspiram",
    note: "Referência visual",
    createdAt: 100,
    updatedAt: 100,
  });

  runtime.save({
    projectId: "project-1",
    url: "https://example.org/espacos",
    title: "Espaços que ajudam a pensar",
    note: "Interface mais calma",
  });
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.references.length, 1);
  assert.equal(snapshot.references[0].id, "project-ref-1");
  assert.equal(snapshot.references[0].createdAt, 100);
  assert.equal(snapshot.references[0].updatedAt, 101);
  assert.equal(snapshot.references[0].title, "Espaços que ajudam a pensar");
  assert.equal(snapshot.references[0].note, "Interface mais calma");
});

test("same URL may be saved independently by different projects", () => {
  const projectRuntime = projects();
  let clock = 200;
  const runtime = createProjectWebReferenceRuntime({
    projects: projectRuntime,
    store: referenceStore(),
    now: () => clock++,
  });
  for (const projectId of ["project-1", "project-2"]) {
    runtime.save({
      projectId,
      url: "https://example.org/",
      title: "Example",
      note: "",
    });
  }
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.references.length, 2);
  assert.deepEqual(
    new Set(snapshot.references.map((reference) => reference.projectId)),
    new Set(["project-1", "project-2"]),
  );
});

test("save rejects unknown projects and unsafe web destinations before mutation", () => {
  const projectRuntime = projects();
  const runtime = createProjectWebReferenceRuntime({
    projects: projectRuntime,
    store: referenceStore(),
    now: () => 300,
  });
  const before = runtime.getSnapshot();

  assert.throws(
    () => runtime.save({
      projectId: "project-99",
      url: "https://example.org/",
      title: "Example",
    }),
    /registered project/,
  );
  assert.throws(
    () => runtime.save({
      projectId: "project-1",
      url: "javascript:alert(1)",
      title: "Unsafe",
    }),
    /http or https/,
  );
  assert.throws(
    () => runtime.save({
      projectId: "project-1",
      url: "https://user:secret@example.org/",
      title: "Credentials",
    }),
    /credentials or host/,
  );
  assert.deepEqual(runtime.getSnapshot(), before);
});

test("project removal prunes its persisted web references but preserves other projects", () => {
  const projectRuntime = projects();
  let clock = 400;
  const runtime = createProjectWebReferenceRuntime({
    projects: projectRuntime,
    store: referenceStore(),
    now: () => clock++,
  });
  runtime.save({
    projectId: "project-1",
    url: "https://one.example/",
    title: "One",
  });
  runtime.save({
    projectId: "project-2",
    url: "https://two.example/",
    title: "Two",
  });

  projectRuntime.remove("project-1");
  const snapshot = runtime.getSnapshot();
  assert.deepEqual(
    snapshot.references.map((reference) => reference.projectId),
    ["project-2"],
  );
});

test("persistence failure degrades to session without losing saved reference", () => {
  const projectRuntime = projects();
  const runtime = createProjectWebReferenceRuntime({
    projects: projectRuntime,
    store: referenceStore({ failSave: true }),
    now: () => 500,
  });
  const snapshot = runtime.save({
    projectId: "project-1",
    url: "https://example.org/",
    title: "Example",
    note: "Sessão",
  });
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.references.length, 1);
  assert.equal(snapshot.references[0].note, "Sessão");
});

test("native store survives recreation and rejects corrupt records", () => {
  const windowRef = localStorageWindow();
  const store = createNativeProjectWebReferenceStore(windowRef);
  store.save({
    nextOrdinal: 2,
    references: [{
      id: "project-ref-1",
      projectId: "project-1",
      url: "https://example.org/",
      title: "Example",
      note: "",
      createdAt: 1,
      updatedAt: 1,
    }],
  });

  const restored = createNativeProjectWebReferenceStore(windowRef);
  assert.equal(restored.scope, "device");
  assert.equal(restored.load().references[0].url, "https://example.org/");

  windowRef.values.set("ordax.native.project-web-references.v1", "{broken");
  const corrupt = createNativeProjectWebReferenceStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyProjectWebReferenceStoreState());
});

test("snapshot validation rejects duplicate project/url pairs", () => {
  assert.throws(
    () => validateProjectWebReferenceSnapshot({
      persistence: "device",
      references: [
        {
          id: "project-ref-1",
          projectId: "project-1",
          url: "https://example.org/",
          title: "One",
          note: "",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "project-ref-2",
          projectId: "project-1",
          url: "https://example.org/",
          title: "Two",
          note: "",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }),
    /only one saved reference per URL/,
  );
});
