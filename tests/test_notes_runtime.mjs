import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_NOTES_SNAPSHOT_SCHEMA,
  MAX_NOTES,
  MAX_NOTE_PROJECTS,
  MAX_NOTE_REFERENCES,
  MAX_NOTE_TASKS,
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
} from "../system/apps/notes/runtime.mjs";
import { countNotesWords, createNotesStatistics } from "../system/apps/notes/statistics.mjs";

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

test("note duplication creates an independent active copy with fresh nested identities", () => {
  let clock = 25_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createNote();
  let state = runtime.getSnapshot();
  const sourceId = state.document.selectedNoteId;
  runtime.updateNote(sourceId, {
    title: "Plano",
    richBody: {
      blocks: [{
        type: "paragraph",
        text: "Conteúdo estruturado",
        marks: [{ type: "bold", start: 0, end: 8 }],
      }],
    },
  });
  runtime.toggleFavorite(sourceId);
  runtime.addTask(sourceId, "Revisar");
  runtime.addReference(sourceId, {
    kind: "link",
    title: "Fonte",
    detail: "Link",
    href: "https://example.org/fonte",
  });

  state = runtime.getSnapshot();
  const source = state.document.notes.find((note) => note.id === sourceId);
  const sourceTaskId = source.tasks[0].id;
  const sourceReferenceId = source.references[0].id;

  runtime.duplicateNote(sourceId);
  state = runtime.getSnapshot();
  const copyId = state.document.selectedNoteId;
  const copy = state.document.notes.find((note) => note.id === copyId);

  assert.notEqual(copyId, sourceId);
  assert.equal(copy.projectId, source.projectId);
  assert.equal(copy.title, "Plano — cópia");
  assert.equal(copy.body, source.body);
  assert.deepEqual(copy.richBody, source.richBody);
  assert.equal(copy.favorite, false);
  assert.equal(copy.deletedAt, null);
  assert.notEqual(copy.createdAt, source.createdAt);
  assert.equal(copy.createdAt, copy.updatedAt);
  assert.equal(copy.tasks[0].text, "Revisar");
  assert.notEqual(copy.tasks[0].id, sourceTaskId);
  assert.equal(copy.references[0].href, "https://example.org/fonte");
  assert.notEqual(copy.references[0].id, sourceReferenceId);

  runtime.updateTask(copyId, copy.tasks[0].id, { text: "Revisar cópia" });
  const afterEdit = runtime.getSnapshot().document;
  assert.equal(
    afterEdit.notes.find((note) => note.id === sourceId).tasks[0].text,
    "Revisar",
  );
  assert.equal(
    afterEdit.notes.find((note) => note.id === copyId).tasks[0].text,
    "Revisar cópia",
  );
});

test("duplicate note fails closed for trash and collection capacity", () => {
  const runtime = createNotesRuntime({ now: () => 26_000 });
  runtime.createNote();
  let state = runtime.getSnapshot();
  const noteId = state.document.selectedNoteId;
  runtime.trashNote(noteId);
  const trashedBefore = runtime.getSnapshot().document;
  runtime.duplicateNote(noteId);
  assert.deepEqual(runtime.getSnapshot().document, trashedBefore);

  const fullNotes = Array.from({ length: MAX_NOTES }, (_, index) => ({
    id: `full-${index}`,
    projectId: NOTES_HOME_PROJECT_ID,
    title: `Nota ${index}`,
    body: "",
    favorite: false,
    deletedAt: null,
    createdAt: index + 1,
    updatedAt: index + 1,
    tasks: [],
    references: [],
  }));
  const fullRuntime = createNotesRuntime({
    store: memoryStore({
      initial: validateNotesSnapshot({
        ...minimalSnapshot(),
        selectedNoteId: "full-0",
        notes: fullNotes,
      }),
    }),
    now: () => 27_000,
  });
  const fullBefore = fullRuntime.getSnapshot().document;
  fullRuntime.duplicateNote("full-0");
  assert.deepEqual(fullRuntime.getSnapshot().document, fullBefore);
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

test("trashed notes are immutable until explicitly restored", () => {
  let clock = 60_000;
  const runtime = createNotesRuntime({ now: () => clock++ });

  runtime.createProject("Destino");
  let state = runtime.getSnapshot();
  const destinationId = state.document.projects.find((project) => project.name === "Destino").id;

  runtime.createNote(NOTES_HOME_PROJECT_ID);
  state = runtime.getSnapshot();
  const noteId = state.document.selectedNoteId;
  runtime.updateNote(noteId, { title: "Original", body: "Texto protegido" });
  runtime.addTask(noteId, "Checklist protegido");
  runtime.addReference(noteId, {
    kind: "link",
    title: "Fonte protegida",
    detail: "Link",
    href: "https://example.org/protegida",
  });

  state = runtime.getSnapshot();
  const active = state.document.notes.find((note) => note.id === noteId);
  const taskId = active.tasks[0].id;
  const referenceId = active.references[0].id;

  runtime.trashNote(noteId);
  state = runtime.getSnapshot();
  const trashed = state.document.notes.find((note) => note.id === noteId);
  assert.notEqual(trashed.deletedAt, null);
  assert.equal(trashed.deletedAt, trashed.updatedAt);

  const immutable = state.document;
  runtime.updateNote(noteId, { title: "Não deve mudar", body: "Mutação bloqueada" });
  runtime.toggleFavorite(noteId);
  runtime.moveNote(noteId, destinationId);
  runtime.addTask(noteId, "Outro item");
  runtime.updateTask(noteId, taskId, { text: "Alterado", done: true });
  runtime.removeTask(noteId, taskId);
  runtime.addReference(noteId, {
    kind: "link",
    title: "Outra fonte",
    detail: "Link",
    href: "https://example.org/outra",
  });
  runtime.removeReference(noteId, referenceId);
  runtime.trashNote(noteId);
  assert.deepEqual(runtime.getSnapshot().document, immutable);

  runtime.restoreNote(noteId);
  state = runtime.getSnapshot();
  let restored = state.document.notes.find((note) => note.id === noteId);
  assert.equal(restored.deletedAt, null);
  assert.equal(state.document.selectedNoteId, noteId);

  const restoredSnapshot = state.document;
  runtime.restoreNote(noteId);
  assert.deepEqual(runtime.getSnapshot().document, restoredSnapshot);

  runtime.updateNote(noteId, { title: "Restaurada" });
  runtime.toggleFavorite(noteId);
  runtime.updateTask(noteId, taskId, { done: true });
  runtime.removeReference(noteId, referenceId);
  runtime.moveNote(noteId, destinationId);

  restored = runtime.getSnapshot().document.notes.find((note) => note.id === noteId);
  assert.equal(restored.title, "Restaurada");
  assert.equal(restored.favorite, true);
  assert.equal(restored.tasks[0].done, true);
  assert.equal(restored.references.length, 0);
  assert.equal(restored.projectId, destinationId);
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

test("runtime collection limits fail closed without validation exceptions or phantom updates", () => {
  const fullProjects = [
    minimalSnapshot().projects[0],
    ...Array.from({ length: MAX_NOTE_PROJECTS - 1 }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Projeto ${index + 1}`,
      createdAt: index + 2,
      updatedAt: index + 2,
    })),
  ];
  const projectRuntime = createNotesRuntime({
    store: memoryStore({
      initial: validateNotesSnapshot({
        ...minimalSnapshot(),
        projects: fullProjects,
      }),
    }),
    now: () => 90_000,
  });
  const projectsBefore = projectRuntime.getSnapshot().document;
  projectRuntime.createProject("Além do limite");
  assert.deepEqual(projectRuntime.getSnapshot().document, projectsBefore);

  const fullNotes = Array.from({ length: MAX_NOTES }, (_, index) => ({
    id: `note-${index + 1}`,
    projectId: NOTES_HOME_PROJECT_ID,
    title: `Nota ${index + 1}`,
    body: "",
    favorite: false,
    deletedAt: null,
    createdAt: index + 1,
    updatedAt: index + 1,
    tasks: [],
    references: [],
  }));
  const noteRuntime = createNotesRuntime({
    store: memoryStore({
      initial: validateNotesSnapshot({
        ...minimalSnapshot(),
        notes: fullNotes,
      }),
    }),
    now: () => 91_000,
  });
  const notesBefore = noteRuntime.getSnapshot().document;
  noteRuntime.createNote();
  assert.deepEqual(noteRuntime.getSnapshot().document, notesBefore);

  const fullTasks = Array.from({ length: MAX_NOTE_TASKS }, (_, index) => ({
    id: `task-${index + 1}`,
    text: `Item ${index + 1}`,
    done: false,
  }));
  const fullReferences = Array.from({ length: MAX_NOTE_REFERENCES }, (_, index) => ({
    id: `ref-${index + 1}`,
    kind: "link",
    title: `Fonte ${index + 1}`,
    detail: "Link",
    href: `https://example.org/${index + 1}`,
  }));
  const boundedRuntime = createNotesRuntime({
    store: memoryStore({
      initial: validateNotesSnapshot({
        ...minimalSnapshot(),
        selectedNoteId: "bounded-note",
        notes: [{
          id: "bounded-note",
          projectId: NOTES_HOME_PROJECT_ID,
          title: "Limites",
          body: "",
          favorite: false,
          deletedAt: null,
          createdAt: 1,
          updatedAt: 1,
          tasks: fullTasks,
          references: fullReferences,
        }],
      }),
    }),
    now: () => 92_000,
  });
  const boundedBefore = boundedRuntime.getSnapshot().document;
  boundedRuntime.addTask("bounded-note", "Além do limite");
  boundedRuntime.addReference("bounded-note", {
    kind: "link",
    title: "Além do limite",
    detail: "Link",
    href: "https://example.org/extra",
  });
  boundedRuntime.removeReference("bounded-note", "ref-inexistente");
  assert.deepEqual(boundedRuntime.getSnapshot().document, boundedBefore);
});

test("semantic no-op mutations do not write, emit, or advance timestamps", () => {
  let stored = null;
  let saves = 0;
  let clock = 100_000;
  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() {
      return stored;
    },
    save(next) {
      stored = validateNotesSnapshot(next);
      saves += 1;
      return true;
    },
  };
  const runtime = createNotesRuntime({ store, now: () => clock++ });
  let emissions = 0;
  const unsubscribe = runtime.subscribe(() => {
    emissions += 1;
  });

  runtime.createNote();
  let state = runtime.getSnapshot();
  const noteId = state.document.selectedNoteId;
  const note = state.document.notes.find((item) => item.id === noteId);
  const afterCreate = {
    saves,
    emissions,
    lastSavedAt: state.persistence.lastSavedAt,
    updatedAt: note.updatedAt,
  };

  runtime.selectNote(noteId);
  runtime.updateNote(noteId, null);
  runtime.updateNote(noteId, { title: note.title });
  runtime.updateNote(noteId, { body: note.body });
  runtime.updateNote(noteId, { richBody: note.richBody });

  state = runtime.getSnapshot();
  assert.equal(saves, afterCreate.saves);
  assert.equal(emissions, afterCreate.emissions);
  assert.equal(state.persistence.lastSavedAt, afterCreate.lastSavedAt);
  assert.equal(
    state.document.notes.find((item) => item.id === noteId).updatedAt,
    afterCreate.updatedAt,
  );

  runtime.updateNote(noteId, { body: "x" });
  const beforeFormat = runtime.getSnapshot();
  const beforeFormatSaves = saves;
  runtime.updateNote(noteId, {
    richBody: {
      blocks: [{
        type: "paragraph",
        text: "x",
        marks: [{ type: "bold", start: 0, end: 1 }],
      }],
    },
  });
  const formatted = runtime.getSnapshot();
  assert.equal(saves, beforeFormatSaves + 1);
  assert.equal(formatted.document.notes.find((item) => item.id === noteId).body, "x");
  assert.equal(
    formatted.document.notes.find((item) => item.id === noteId).richBody.blocks[0].marks[0].type,
    "bold",
  );
  assert.ok(formatted.persistence.lastSavedAt > beforeFormat.persistence.lastSavedAt);

  runtime.addTask(noteId, "Item");
  state = runtime.getSnapshot();
  const task = state.document.notes.find((item) => item.id === noteId).tasks[0];
  const beforeTaskNoop = {
    saves,
    emissions,
    lastSavedAt: state.persistence.lastSavedAt,
    updatedAt: state.document.notes.find((item) => item.id === noteId).updatedAt,
  };
  runtime.updateTask(noteId, task.id, null);
  runtime.updateTask(noteId, task.id, { text: task.text, done: task.done });
  state = runtime.getSnapshot();
  assert.equal(saves, beforeTaskNoop.saves);
  assert.equal(emissions, beforeTaskNoop.emissions);
  assert.equal(state.persistence.lastSavedAt, beforeTaskNoop.lastSavedAt);
  assert.equal(
    state.document.notes.find((item) => item.id === noteId).updatedAt,
    beforeTaskNoop.updatedAt,
  );

  runtime.createProject("Projeto idempotente");
  state = runtime.getSnapshot();
  const projectId = state.document.selectedProjectId;
  const project = state.document.projects.find((item) => item.id === projectId);
  const beforeProjectNoop = {
    saves,
    emissions,
    lastSavedAt: state.persistence.lastSavedAt,
    updatedAt: project.updatedAt,
  };
  runtime.selectProject(projectId);
  runtime.renameProject(projectId, `  ${project.name}  `);
  state = runtime.getSnapshot();
  assert.equal(saves, beforeProjectNoop.saves);
  assert.equal(emissions, beforeProjectNoop.emissions);
  assert.equal(state.persistence.lastSavedAt, beforeProjectNoop.lastSavedAt);
  assert.equal(
    state.document.projects.find((item) => item.id === projectId).updatedAt,
    beforeProjectNoop.updatedAt,
  );

  unsubscribe();
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

test("notes statistics count Unicode words and editor metadata without mutating notes", () => {
  assert.equal(countNotesWords("Olá mundo — OrdaX 2026"), 4);
  assert.equal(countNotesWords("  "), 0);

  const tasks = [{ done: true }, { done: false }, { done: true }];
  const references = [{ id: "ref-1" }, { id: "ref-2" }];
  const snapshot = createNotesStatistics({
    text: "Uma nota com cinco palavras",
    tasks,
    references,
  });

  assert.equal(snapshot.schema, "ordax.notes-statistics/1");
  assert.equal(snapshot.words, 5);
  assert.equal(snapshot.characters, 27);
  assert.equal(snapshot.tasks, 3);
  assert.equal(snapshot.completedTasks, 2);
  assert.equal(snapshot.references, 2);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(tasks, [{ done: true }, { done: false }, { done: true }]);
});

test("notes statistics count Unicode code points rather than UTF-16 units", () => {
  const snapshot = createNotesStatistics({
    text: "Oi 👋",
    tasks: [],
    references: [],
  });
  assert.equal(snapshot.words, 1);
  assert.equal(snapshot.characters, 4);
});

