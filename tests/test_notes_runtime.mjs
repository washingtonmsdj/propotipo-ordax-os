import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_NOTES_SNAPSHOT_SCHEMA,
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  createNotesRichBodyFromPlainText,
  notesRichBodyToPlainText,
  validateNotesRichBody,
  validateNotesSnapshot,
} from "../system/contracts/notes-store.mjs";
import { createWebNotesStore } from "../system/adapters/web/notes.mjs";
import { createNativeNotesStore } from "../system/adapters/native/notes.mjs";
import {
  NOTES_HOME_PROJECT_ID,
  createNotesRuntime,
} from "../system/services/notes/runtime.mjs";

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
        richBody: {
          blocks: [{
            type: "paragraph",
            text: "Texto local",
            marks: [{ type: "bold", start: 0, end: 5 }],
          }],
        },
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

  assert.equal(snapshot.$schema, NOTES_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.notes[0].tasks[0].text, "Revisar");
  assert.equal(snapshot.notes[0].richBody.blocks[0].marks[0].type, "bold");
  assert.equal(snapshot.notes[0].references[0].kind, "link");
  assert.equal(snapshot.notes[0].references[1].path, "/Documentos/direcao-visual.pdf");
  assert.equal(Object.isFrozen(snapshot.notes[0]), true);

  assert.throws(
    () => validateNotesSnapshot({
      ...minimalSnapshot(),
      selectedNoteId: "nota-divergente",
      notes: [{
        id: "nota-divergente",
        projectId: "meu-espaco",
        title: "Divergente",
        body: "texto A",
        richBody: {
          blocks: [{ type: "paragraph", text: "texto B", marks: [] }],
        },
        favorite: false,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1,
        tasks: [],
        references: [],
      }],
    }),
    /same text/,
  );

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

test("rich note bodies stay bounded, structured and plain-text compatible", () => {
  const rich = validateNotesRichBody({
    blocks: [
      {
        type: "heading",
        text: "Plano",
        marks: [{ type: "bold", start: 0, end: 5 }],
      },
      {
        type: "paragraph",
        text: "Leia a fonte",
        marks: [{
          type: "link",
          start: 7,
          end: 12,
          href: "https://example.org",
        }],
      },
      {
        type: "quote",
        text: "Continuar simples",
        marks: [{ type: "italic", start: 0, end: 16 }],
      },
      {
        type: "bullet",
        text: "Revisar",
        marks: [],
      },
    ],
  });
  assert.equal(notesRichBodyToPlainText(rich), "Plano\nLeia a fonte\nContinuar simples\nRevisar");
  assert.equal(createNotesRichBodyFromPlainText("A\nB").blocks.length, 1);
  assert.equal(createNotesRichBodyFromPlainText("A\nB").blocks[0].text, "A\nB");
  assert.throws(
    () => validateNotesRichBody({
      blocks: [{
        type: "paragraph",
        text: "abc",
        marks: [{ type: "bold", start: 0, end: 4 }],
      }],
    }),
    /mark range/,
  );
  assert.throws(
    () => validateNotesRichBody({
      blocks: [{
        type: "paragraph",
        text: "abc",
        marks: [{ type: "link", start: 0, end: 3, href: "ftp://example.org" }],
      }],
    }),
    /http or https/,
  );
});

test("legacy v1 snapshots migrate in memory and all future saves emit v2", () => {
  const legacy = {
    ...minimalSnapshot(),
    $schema: LEGACY_NOTES_SNAPSHOT_SCHEMA,
    selectedNoteId: "legacy-note",
    notes: [{
      id: "legacy-note",
      projectId: "meu-espaco",
      title: "Legada",
      body: "Linha 1\nLinha 2",
      favorite: false,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      tasks: [],
      references: [],
    }],
  };

  const migrated = validateNotesSnapshot(legacy);
  assert.equal(migrated.$schema, NOTES_SNAPSHOT_SCHEMA);
  assert.equal(migrated.notes[0].body, "Linha 1\nLinha 2");
  assert.equal(migrated.notes[0].richBody.blocks.length, 1);
  assert.equal(migrated.notes[0].richBody.blocks[0].text, "Linha 1\nLinha 2");
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
  let formatted = first.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.equal(formatted.richBody.blocks[0].text, "Primeira versão");
  first.updateNote(noteId, {
    richBody: {
      blocks: [{
        type: "paragraph",
        text: "Primeira versão",
        marks: [{ type: "italic", start: 0, end: 8 }],
      }],
    },
  });
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
  assert.equal(note.richBody.blocks[0].marks[0].type, "italic");
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
  assert.equal(reloaded.richBody.blocks[0].marks[0].type, "italic");
  assert.equal(reloaded.tasks[0].text, "Validar fluxo");
  assert.equal(reloaded.references[0].href, "https://example.org/docs");
  assert.equal(reloaded.references[1].path, "/Documentos/brief.pdf");
});

test("project lifecycle moves notes safely and protects the home project", () => {
  let clock = 30_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createProject("Pesquisa");
  let state = runtime.getSnapshot();
  const research = state.document.projects.find((project) => project.name === "Pesquisa");
  assert.ok(research);

  runtime.createProject("Arquivo");
  state = runtime.getSnapshot();
  const archive = state.document.projects.find((project) => project.name === "Arquivo");
  assert.ok(archive);

  runtime.renameProject(research.id, "Pesquisa OrdaX");
  state = runtime.getSnapshot();
  assert.equal(
    state.document.projects.find((project) => project.id === research.id).name,
    "Pesquisa OrdaX",
  );

  runtime.createNote(research.id);
  state = runtime.getSnapshot();
  const noteId = state.document.selectedNoteId;
  runtime.updateNote(noteId, { title: "Mover esta nota" });
  runtime.moveNote(noteId, archive.id);
  state = runtime.getSnapshot();
  assert.equal(state.document.selectedProjectId, archive.id);
  assert.equal(state.document.selectedNoteId, noteId);
  assert.equal(
    state.document.notes.find((note) => note.id === noteId).projectId,
    archive.id,
  );

  runtime.removeProject(archive.id);
  state = runtime.getSnapshot();
  assert.equal(state.document.projects.some((project) => project.id === archive.id), false);
  assert.equal(state.document.selectedProjectId, NOTES_HOME_PROJECT_ID);
  assert.equal(state.document.selectedNoteId, noteId);
  assert.equal(
    state.document.notes.find((note) => note.id === noteId).projectId,
    NOTES_HOME_PROJECT_ID,
  );

  const beforeHomeRemoval = state.document;
  runtime.renameProject(NOTES_HOME_PROJECT_ID, "Outro nome");
  assert.deepEqual(runtime.getSnapshot().document, beforeHomeRemoval);
  runtime.removeProject(NOTES_HOME_PROJECT_ID);
  state = runtime.getSnapshot();
  assert.deepEqual(state.document, beforeHomeRemoval);
  assert.equal(
    state.document.projects.find((project) => project.id === NOTES_HOME_PROJECT_ID).name,
    "Meu espaço",
  );
});

test("trash requires explicit permanent deletion and supports emptying all deleted notes", () => {
  let clock = 50_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createNote();
  let state = runtime.getSnapshot();
  const keepId = state.document.selectedNoteId;
  runtime.updateNote(keepId, { title: "Manter" });

  runtime.createNote();
  state = runtime.getSnapshot();
  const deleteId = state.document.selectedNoteId;
  runtime.updateNote(deleteId, { title: "Apagar" });

  const activeBeforeDelete = runtime.getSnapshot().document;
  runtime.permanentlyDeleteNote(deleteId);
  assert.deepEqual(runtime.getSnapshot().document, activeBeforeDelete);

  runtime.trashNote(deleteId);
  state = runtime.getSnapshot();
  assert.notEqual(state.document.notes.find((note) => note.id === deleteId).deletedAt, null);

  runtime.permanentlyDeleteNote(deleteId);
  state = runtime.getSnapshot();
  assert.equal(state.document.notes.some((note) => note.id === deleteId), false);
  assert.equal(state.document.notes.some((note) => note.id === keepId), true);

  runtime.createNote();
  const trashOne = runtime.getSnapshot().document.selectedNoteId;
  runtime.trashNote(trashOne);
  runtime.createNote();
  const trashTwo = runtime.getSnapshot().document.selectedNoteId;
  runtime.trashNote(trashTwo);

  state = runtime.getSnapshot();
  assert.equal(state.document.notes.filter((note) => note.deletedAt !== null).length, 2);
  runtime.emptyTrash();
  state = runtime.getSnapshot();
  assert.equal(state.document.notes.filter((note) => note.deletedAt !== null).length, 0);
  assert.equal(state.document.notes.some((note) => note.id === keepId), true);

  const unchanged = runtime.getSnapshot().document;
  runtime.emptyTrash();
  assert.deepEqual(runtime.getSnapshot().document, unchanged);
});

test("checklist items can be removed without affecting sibling items", () => {
  let clock = 40_000;
  const runtime = createNotesRuntime({ now: () => clock++ });
  runtime.createNote();
  const noteId = runtime.getSnapshot().document.selectedNoteId;

  runtime.addTask(noteId, "Primeiro");
  runtime.addTask(noteId, "Segundo");
  let note = runtime.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.equal(note.tasks.length, 2);

  const firstTaskId = note.tasks[0].id;
  const secondTaskId = note.tasks[1].id;
  runtime.removeTask(noteId, firstTaskId);

  note = runtime.getSnapshot().document.notes.find((item) => item.id === noteId);
  assert.deepEqual(note.tasks.map((task) => task.id), [secondTaskId]);
  assert.equal(note.tasks[0].text, "Segundo");

  const unchanged = runtime.getSnapshot().document;
  runtime.removeTask(noteId, "task:missing");
  assert.deepEqual(runtime.getSnapshot().document, unchanged);
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
  assert.equal(second.load().$schema, NOTES_SNAPSHOT_SCHEMA);
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

test("storage adapters migrate legacy v1 note content without dropping text", async () => {
  const legacy = {
    ...minimalSnapshot(),
    $schema: LEGACY_NOTES_SNAPSHOT_SCHEMA,
    selectedNoteId: "legacy-adapter-note",
    notes: [{
      id: "legacy-adapter-note",
      projectId: "meu-espaco",
      title: "Legada",
      body: "Texto antigo\ncontinua aqui",
      favorite: false,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      tasks: [],
      references: [],
    }],
  };

  const storage = memoryStorage();
  storage.setItem("ordax.notes.v1", JSON.stringify(legacy));
  const web = createWebNotesStore({ localStorage: storage });
  assert.equal(web.load().$schema, NOTES_SNAPSHOT_SCHEMA);
  assert.equal(web.load().notes[0].body, "Texto antigo\ncontinua aqui");
  assert.equal(web.load().notes[0].richBody.blocks[0].text, "Texto antigo\ncontinua aqui");

  const native = await createNativeNotesStore({
    async fetch(_url, options) {
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { payload: JSON.stringify(legacy) };
          },
        };
      }
      return { ok: true, status: 204 };
    },
  });
  assert.equal(native.load().$schema, NOTES_SNAPSHOT_SCHEMA);
  assert.equal(native.load().notes[0].body, "Texto antigo\ncontinua aqui");
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
