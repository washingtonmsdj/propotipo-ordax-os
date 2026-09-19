import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  validateNotesSnapshot,
} from "../system/contracts/notes-store.mjs";
import { createWebNotesStore } from "../system/adapters/web/notes.mjs";
import { createNativeNotesStore } from "../system/adapters/native/notes.mjs";
import { createNotesRuntime } from "../system/services/notes/runtime.mjs";

function memoryStore({ initial = null, scope = "device", saveResult = true } = {}) {
  let snapshot = initial;
  return {
    schema: NOTES_STORE_SCHEMA,
    scope,
    load() {
      return snapshot;
    },
    save(next) {
      snapshot = validateNotesSnapshot(next);
      return saveResult;
    },
    read() {
      return snapshot;
    },
  };
}

function minimalSnapshot() {
  return {
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "meu-espaco",
    selectedNoteId: null,
    projects: [
      {
        id: "meu-espaco",
        name: "Meu espaço",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    notes: [],
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("notes contract preserves bounded projects, tasks and references", () => {
  const snapshot = validateNotesSnapshot({
    ...minimalSnapshot(),
    selectedNoteId: "nota-1",
    notes: [
      {
        id: "nota-1",
        projectId: "meu-espaco",
        title: "Ideia",
        body: "Texto local",
        favorite: true,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 2,
        tasks: [{ id: "task-1", text: "Revisar", done: false }],
        references: [{
          id: "ref-1",
          kind: "link",
          title: "Fonte",
          detail: "Referência",
          href: "https://example.org",
        }, {
          id: "ref-file",
          kind: "file",
          title: "direcao-visual.pdf",
          detail: "Arquivo local",
          path: "/Documentos/direcao-visual.pdf",
        }],
      },
    ],
  });

  assert.equal(snapshot.notes[0].tasks[0].text, "Revisar");
  assert.equal(snapshot.notes[0].references[0].kind, "link");
  assert.equal(snapshot.notes[0].references[1].path, "/Documentos/direcao-visual.pdf");
  assert.equal(Object.isFrozen(snapshot.notes[0]), true);

  assert.throws(
    () => validateNotesSnapshot({
      ...minimalSnapshot(),
      notes: [{
        id: "nota-2",
        projectId: "projeto-inexistente",
        title: "Inválida",
        body: "",
        favorite: false,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
        tasks: [],
        references: [],
      }],
    }),
    /unknown project/,
  );

  assert.throws(
    () => validateNotesSnapshot({
      ...minimalSnapshot(),
      selectedNoteId: "nota-arquivo",
      notes: [{
        id: "nota-arquivo",
        projectId: "meu-espaco",
        title: "Inválida",
        body: "",
        favorite: false,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
        tasks: [],
        references: [{
          id: "ref-arquivo",
          kind: "file",
          title: "fora.txt",
          detail: "",
          path: "../fora.txt",
        }],
      }],
    }),
    /absolute logical path/,
  );

  assert.throws(
    () => validateNotesSnapshot({
      ...minimalSnapshot(),
      selectedNoteId: "nota-3",
      notes: [{
        id: "nota-3",
        projectId: "meu-espaco",
        title: "Inválida",
        body: "",
        favorite: false,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
        tasks: [],
        references: [{
          id: "ref-2",
          kind: "link",
          title: "FTP",
          detail: "",
          href: "ftp://example.org",
        }],
      }],
    }),
    /http or https/,
  );
});

test("notes runtime edits, organizes and reloads durable state", () => {
  let clock = 10_000;
  const store = memoryStore();
  const first = createNotesRuntime({ store, now: () => clock++ });

  const seeded = first.getSnapshot();
  assert.equal(seeded.persistence.scope, "device");
  assert.equal(seeded.persistence.ok, true);
  assert.equal(seeded.document.projects.length, 1);
  assert.equal(seeded.document.projects[0].name, "Meu espaço");
  assert.equal(seeded.document.notes.length, 0);
  assert.equal(seeded.document.selectedNoteId, null);

  first.createProject("Projeto real");
  let state = first.getSnapshot();
  const project = state.document.projects.find((item) => item.name === "Projeto real");
  assert.ok(project);

  first.createNote(project.id);
  state = first.getSnapshot();
  const noteId = state.document.selectedNoteId;
  assert.ok(noteId);
  first.updateNote(noteId, { title: "Plano", body: "Primeira versão" });
  first.addTask(noteId, "Validar fluxo");
  first.toggleFavorite(noteId);
  first.addReference(noteId, {
    kind: "link",
    title: "Documentação",
    detail: "Leitura",
    href: "https://example.org/docs",
  });
  first.addReference(noteId, {
    kind: "file",
    title: "brief.pdf",
    detail: "Arquivo local",
    path: "/Documentos/brief.pdf",
  });

  state = first.getSnapshot();
  let note = state.document.notes.find((item) => item.id === noteId);
  assert.equal(note.title, "Plano");
  assert.equal(note.body, "Primeira versão");
  assert.equal(note.favorite, true);
  assert.equal(note.tasks[0].text, "Validar fluxo");
  assert.equal(note.references[0].title, "Documentação");
  assert.equal(note.references[1].path, "/Documentos/brief.pdf");

  first.trashNote(noteId);
  note = first.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.ok(note.deletedAt !== null);
  first.restoreNote(noteId);
  note = first.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.equal(note.deletedAt, null);

  const second = createNotesRuntime({ store, now: () => clock++ });
  const reloaded = second.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.equal(reloaded.title, "Plano");
  assert.equal(reloaded.tasks[0].text, "Validar fluxo");
  assert.equal(reloaded.references[0].href, "https://example.org/docs");
  assert.equal(reloaded.references[1].path, "/Documentos/brief.pdf");
});

test("notes runtime exposes local persistence failure without losing session state", () => {
  const runtime = createNotesRuntime({
    store: memoryStore({ saveResult: false }),
    now: () => 20_000,
  });
  let state = runtime.getSnapshot();
  assert.equal(state.persistence.scope, "device");
  assert.equal(state.persistence.ok, false);

  const created = runtime.createNote();
  assert.ok(created.document.selectedNoteId);
  state = runtime.updateNote(created.document.selectedNoteId, { title: "Ainda em memória" });
  assert.equal(state.persistence.ok, false);
  assert.equal(
    state.document.notes.find((note) => note.id === state.document.selectedNoteId).title,
    "Ainda em memória",
  );
});

test("web notes store survives recreation and degrades cleanly when storage is denied", () => {
  const storage = memoryStorage();
  const windowRef = { localStorage: storage };
  const first = createWebNotesStore(windowRef);
  first.save(validateNotesSnapshot(minimalSnapshot()));
  assert.equal(first.scope, "device");

  const second = createWebNotesStore(windowRef);
  assert.equal(second.load().projects[0].name, "Meu espaço");

  const denied = {};
  Object.defineProperty(denied, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const session = createWebNotesStore(denied);
  assert.equal(session.scope, "session");
  assert.equal(session.load(), null);
});

test("native notes adapter uses the loopback endpoint and queues durable writes", async () => {
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { payload: null };
          },
        };
      }
      return {
        ok: true,
        status: 204,
      };
    },
  };

  const store = await createNativeNotesStore(windowRef);
  assert.equal(store.scope, "device");
  assert.equal(store.load(), null);

  store.save(validateNotesSnapshot(minimalSnapshot()));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[0].url, "/__ordax/native/notes");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "/__ordax/native/notes");
  assert.equal(calls[1].options.method, "POST");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(JSON.parse(body.payload).$schema, NOTES_SNAPSHOT_SCHEMA);
});
