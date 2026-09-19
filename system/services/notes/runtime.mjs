import {
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  createNotesRichBodyFromPlainText,
  notesRichBodyToPlainText,
  validateNotesRichBody,
  validateNotesSnapshot,
} from "../../contracts/notes-store.mjs";

export const NOTES_RUNTIME_SCHEMA = "ordax.notes-runtime/1";
export const NOTES_HOME_PROJECT_ID = "meu-espaco";

function defaultSnapshot(now = Date.now()) {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: NOTES_HOME_PROJECT_ID,
    selectedNoteId: null,
    projects: [
      { id: NOTES_HOME_PROJECT_ID, name: "Meu espaço", createdAt: now, updatedAt: now },
    ],
    notes: [],
  });
}

function thaw(snapshot) {
  return {
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: snapshot.selectedProjectId,
    selectedNoteId: snapshot.selectedNoteId,
    projects: snapshot.projects.map((project) => ({ ...project })),
    notes: snapshot.notes.map((note) => ({
      ...note,
      richBody: {
        blocks: note.richBody.blocks.map((block) => ({
          ...block,
          marks: block.marks.map((mark) => ({ ...mark })),
        })),
      },
      tasks: note.tasks.map((task) => ({ ...task })),
      references: note.references.map((reference) => ({ ...reference })),
    })),
  };
}

export function createNotesRuntime({ store = null, now = () => Date.now() } = {}) {
  let memoryStore = null;
  if (store === null) {
    let memory = null;
    memoryStore = {
      schema: NOTES_STORE_SCHEMA,
      scope: "session",
      load() { return memory; },
      save(snapshot) { memory = validateNotesSnapshot(snapshot); return true; },
    };
  }
  const notesStore = assertNotesStore(store ?? memoryStore);
  let snapshot;
  try {
    snapshot = notesStore.load();
    snapshot = snapshot === null ? defaultSnapshot(now()) : validateNotesSnapshot(snapshot);
  } catch {
    snapshot = defaultSnapshot(now());
  }
  let initialSaveSucceeded = true;
  try {
    initialSaveSucceeded = notesStore.save(snapshot) !== false;
  } catch {
    initialSaveSucceeded = false;
  }

  const listeners = new Set();
  let ordinal = 0;
  let lastSavedAt = now();
  let lastSaveSucceeded = initialSaveSucceeded;

  const emit = () => {
    const state = runtime.getSnapshot();
    for (const listener of [...listeners]) listener(state);
  };

  const commit = (draft) => {
    snapshot = validateNotesSnapshot(draft);
    try {
      lastSaveSucceeded = notesStore.save(snapshot) !== false;
    } catch {
      lastSaveSucceeded = false;
    }
    lastSavedAt = now();
    emit();
    return runtime.getSnapshot();
  };

  const id = (prefix) => {
    ordinal += 1;
    return `${prefix}:${now().toString(36)}:${ordinal.toString(36)}`;
  };

  const requireNoteIndex = (draft, noteId) => {
    const index = draft.notes.findIndex((note) => note.id === noteId);
    if (index < 0) throw new RangeError(`Unknown note: ${noteId}`);
    return index;
  };

  const requireProjectIndex = (draft, projectId) => {
    const index = draft.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new RangeError(`Unknown note project: ${projectId}`);
    return index;
  };

  const runtime = {
    schema: NOTES_RUNTIME_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        document: snapshot,
        persistence: Object.freeze({
          scope: notesStore.scope,
          lastSavedAt,
          ok: lastSaveSucceeded,
        }),
      });
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Notes listener must be a function");
      listeners.add(listener);
      listener(runtime.getSnapshot());
      return () => listeners.delete(listener);
    },
    selectProject(projectId) {
      const draft = thaw(snapshot);
      if (!draft.projects.some((project) => project.id === projectId)) return runtime.getSnapshot();
      draft.selectedProjectId = projectId;
      const next = draft.notes.find((note) => note.projectId === projectId && note.deletedAt === null);
      draft.selectedNoteId = next?.id ?? null;
      return commit(draft);
    },
    selectNote(noteId) {
      const draft = thaw(snapshot);
      const note = draft.notes.find((candidate) => candidate.id === noteId);
      if (!note) return runtime.getSnapshot();
      draft.selectedProjectId = note.projectId;
      draft.selectedNoteId = note.id;
      return commit(draft);
    },
    createNote(projectId = snapshot.selectedProjectId) {
      const draft = thaw(snapshot);
      if (!draft.projects.some((project) => project.id === projectId)) {
        throw new RangeError(`Unknown note project: ${projectId}`);
      }
      const stamp = now();
      const noteId = id("note");
      draft.notes.unshift({
        id: noteId,
        projectId,
        title: "Sem título",
        body: "",
        richBody: createNotesRichBodyFromPlainText(""),
        favorite: false,
        deletedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
        tasks: [],
        references: [],
      });
      draft.selectedProjectId = projectId;
      draft.selectedNoteId = noteId;
      return commit(draft);
    },
    createProject(name) {
      const cleanName = String(name ?? "").trim();
      if (!cleanName) return runtime.getSnapshot();
      const draft = thaw(snapshot);
      const stamp = now();
      const projectId = id("project");
      draft.projects.push({ id: projectId, name: cleanName.slice(0, 160), createdAt: stamp, updatedAt: stamp });
      draft.selectedProjectId = projectId;
      draft.selectedNoteId = null;
      return commit(draft);
    },
    renameProject(projectId, name) {
      if (projectId === NOTES_HOME_PROJECT_ID) return runtime.getSnapshot();
      const cleanName = String(name ?? "").trim();
      if (!cleanName) return runtime.getSnapshot();
      const draft = thaw(snapshot);
      const index = requireProjectIndex(draft, projectId);
      draft.projects[index] = {
        ...draft.projects[index],
        name: cleanName.slice(0, 160),
        updatedAt: now(),
      };
      return commit(draft);
    },
    moveNote(noteId, projectId) {
      const draft = thaw(snapshot);
      const noteIndex = requireNoteIndex(draft, noteId);
      requireProjectIndex(draft, projectId);
      if (draft.notes[noteIndex].projectId === projectId) return runtime.getSnapshot();
      draft.notes[noteIndex] = {
        ...draft.notes[noteIndex],
        projectId,
        updatedAt: now(),
      };
      if (draft.selectedNoteId === noteId) {
        draft.selectedProjectId = projectId;
      }
      return commit(draft);
    },
    removeProject(projectId) {
      if (projectId === NOTES_HOME_PROJECT_ID) return runtime.getSnapshot();
      const draft = thaw(snapshot);
      const projectIndex = requireProjectIndex(draft, projectId);
      const stamp = now();
      requireProjectIndex(draft, NOTES_HOME_PROJECT_ID);
      draft.notes = draft.notes.map((note) => (
        note.projectId === projectId
          ? { ...note, projectId: NOTES_HOME_PROJECT_ID, updatedAt: stamp }
          : note
      ));
      draft.projects.splice(projectIndex, 1);
      if (draft.selectedProjectId === projectId) {
        draft.selectedProjectId = NOTES_HOME_PROJECT_ID;
        if (
          draft.selectedNoteId === null
          || !draft.notes.some((note) => note.id === draft.selectedNoteId && note.deletedAt === null)
        ) {
          draft.selectedNoteId = draft.notes.find(
            (note) => note.projectId === NOTES_HOME_PROJECT_ID && note.deletedAt === null,
          )?.id ?? null;
        }
      }
      return commit(draft);
    },
    updateNote(noteId, patch) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      const current = draft.notes[index];
      const next = { ...current, updatedAt: now() };
      if (Object.prototype.hasOwnProperty.call(patch, "title")) {
        next.title = String(patch.title ?? "").slice(0, 1024);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "richBody")) {
        next.richBody = validateNotesRichBody(patch.richBody);
        next.body = notesRichBodyToPlainText(next.richBody);
      } else if (Object.prototype.hasOwnProperty.call(patch, "body")) {
        next.body = String(patch.body ?? "").slice(0, 65536);
        next.richBody = createNotesRichBodyFromPlainText(next.body);
      }
      draft.notes[index] = next;
      return commit(draft);
    },
    toggleFavorite(noteId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index] = { ...draft.notes[index], favorite: !draft.notes[index].favorite, updatedAt: now() };
      return commit(draft);
    },
    trashNote(noteId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index] = { ...draft.notes[index], deletedAt: now(), updatedAt: now() };
      if (draft.selectedNoteId === noteId) {
        draft.selectedNoteId = draft.notes.find((note) => note.projectId === draft.selectedProjectId && note.deletedAt === null)?.id ?? null;
      }
      return commit(draft);
    },
    restoreNote(noteId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index] = { ...draft.notes[index], deletedAt: null, updatedAt: now() };
      draft.selectedProjectId = draft.notes[index].projectId;
      draft.selectedNoteId = noteId;
      return commit(draft);
    },
    permanentlyDeleteNote(noteId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      if (draft.notes[index].deletedAt === null) return runtime.getSnapshot();
      draft.notes.splice(index, 1);
      if (draft.selectedNoteId === noteId) draft.selectedNoteId = null;
      return commit(draft);
    },
    emptyTrash() {
      const draft = thaw(snapshot);
      const deletedIds = new Set(
        draft.notes.filter((note) => note.deletedAt !== null).map((note) => note.id),
      );
      if (deletedIds.size === 0) return runtime.getSnapshot();
      draft.notes = draft.notes.filter((note) => note.deletedAt === null);
      if (draft.selectedNoteId !== null && deletedIds.has(draft.selectedNoteId)) {
        draft.selectedNoteId = null;
      }
      return commit(draft);
    },
    addTask(noteId, text = "Novo item") {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index].tasks.push({ id: id("task"), text: String(text).slice(0, 2048), done: false });
      draft.notes[index].updatedAt = now();
      return commit(draft);
    },
    updateTask(noteId, taskId, patch) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      const taskIndex = draft.notes[index].tasks.findIndex((task) => task.id === taskId);
      if (taskIndex < 0) return runtime.getSnapshot();
      const task = { ...draft.notes[index].tasks[taskIndex] };
      if (Object.prototype.hasOwnProperty.call(patch, "text")) task.text = String(patch.text ?? "").slice(0, 2048);
      if (Object.prototype.hasOwnProperty.call(patch, "done")) task.done = patch.done === true;
      draft.notes[index].tasks[taskIndex] = task;
      draft.notes[index].updatedAt = now();
      return commit(draft);
    },
    removeTask(noteId, taskId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      const before = draft.notes[index].tasks.length;
      draft.notes[index].tasks = draft.notes[index].tasks.filter((task) => task.id !== taskId);
      if (draft.notes[index].tasks.length === before) return runtime.getSnapshot();
      draft.notes[index].updatedAt = now();
      return commit(draft);
    },
    addReference(noteId, reference) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index].references.push({
        id: id("ref"),
        kind: reference?.kind === "file" ? "file" : "link",
        title: String(reference?.title ?? "Referência").slice(0, 512),
        detail: String(reference?.detail ?? "").slice(0, 1024),
        href: reference?.kind === "file" ? "" : String(reference?.href ?? "").slice(0, 4096),
        path: reference?.kind === "file" ? String(reference?.path ?? "").slice(0, 4096) : "",
      });
      draft.notes[index].updatedAt = now();
      return commit(draft);
    },
    removeReference(noteId, referenceId) {
      const draft = thaw(snapshot);
      const index = requireNoteIndex(draft, noteId);
      draft.notes[index].references = draft.notes[index].references.filter((reference) => reference.id !== referenceId);
      draft.notes[index].updatedAt = now();
      return commit(draft);
    },
    destroy() {
      listeners.clear();
    },
  };

  return Object.freeze(runtime);
}

export function assertNotesRuntime(runtime) {
  if (!runtime || runtime.schema !== NOTES_RUNTIME_SCHEMA) {
    throw new TypeError("A compatible notes runtime is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "selectProject",
    "selectNote",
    "createNote",
    "createProject",
    "renameProject",
    "removeProject",
    "moveNote",
    "updateNote",
    "trashNote",
    "restoreNote",
    "permanentlyDeleteNote",
    "emptyTrash",
    "addTask",
    "updateTask",
    "removeTask",
  ]) {
    if (typeof runtime[method] !== "function") throw new TypeError(`Notes runtime must implement ${method}()`);
  }
  return runtime;
}
