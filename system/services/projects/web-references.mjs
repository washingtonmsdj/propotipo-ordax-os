import { assertProjectCatalogPort, validateProjectId } from "../../contracts/project-catalog.mjs";
import {
  MAX_PROJECT_WEB_REFERENCES,
  MAX_PROJECT_WEB_NOTE_LENGTH,
  MAX_PROJECT_WEB_TITLE_LENGTH,
  PROJECT_WEB_REFERENCES_SCHEMA,
  assertProjectWebReferencePort,
  validateProjectWebReferenceId,
  validateProjectWebReferenceSnapshot,
  validateProjectWebReferences,
  validateProjectWebUrl,
} from "../../contracts/project-web-references.mjs";
import {
  assertProjectWebReferenceStore,
  createEmptyProjectWebReferenceStoreState,
  validateProjectWebReferenceStoreState,
} from "../../contracts/project-web-reference-store.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Project web-reference runtime clock is invalid");
  }
  return value;
}

function boundedText(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return text;
}

function sameReferences(left, right) {
  if (left.length !== right.length) return false;
  return left.every((reference, index) => {
    const candidate = right[index];
    return reference.id === candidate.id
      && reference.projectId === candidate.projectId
      && reference.url === candidate.url
      && reference.title === candidate.title
      && reference.note === candidate.note
      && reference.createdAt === candidate.createdAt
      && reference.updatedAt === candidate.updatedAt;
  });
}

export function createProjectWebReferenceRuntime({
  store = null,
  projects,
  now = Date.now,
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Project web-reference runtime requires a clock");
  }
  const projectPort = assertProjectCatalogPort(projects);
  const durableStore = store === null ? null : assertProjectWebReferenceStore(store);
  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyProjectWebReferenceStoreState();
  const listeners = new Set();
  let destroyed = false;

  if (durableStore) {
    try {
      state = validateProjectWebReferenceStoreState(durableStore.load());
    } catch {
      state = createEmptyProjectWebReferenceStoreState();
      persistence = "session";
    }
  }

  const snapshot = () => validateProjectWebReferenceSnapshot({
    persistence,
    references: state.references,
  });

  const emit = () => {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) listener(next);
  };

  const persist = (nextState) => {
    state = validateProjectWebReferenceStoreState(nextState);
    if (!durableStore) {
      persistence = "session";
      return;
    }
    try {
      const saved = durableStore.save(state) !== false;
      persistence = saved && durableStore.scope === "device" ? "device" : "session";
    } catch {
      persistence = "session";
    }
  };

  const replaceState = (nextState) => {
    const validated = validateProjectWebReferenceStoreState(nextState);
    if (
      validated.nextOrdinal === state.nextOrdinal
      && sameReferences(validated.references, state.references)
    ) {
      return false;
    }
    persist(validated);
    emit();
    return true;
  };

  const projectExists = (projectId) => projectPort
    .getSnapshot()
    .projects
    .some((project) => project.id === projectId);

  const removeMissingProjects = (projectSnapshot = projectPort.getSnapshot()) => {
    const projectIds = new Set(projectSnapshot.projects.map((project) => project.id));
    const references = state.references.filter((reference) => projectIds.has(reference.projectId));
    if (references.length === state.references.length) return false;
    return replaceState({
      nextOrdinal: state.nextOrdinal,
      references,
    });
  };

  removeMissingProjects();
  const unsubscribeProjects = projectPort.subscribe((nextProjectSnapshot) => {
    removeMissingProjects(nextProjectSnapshot);
  });

  const runtime = {
    schema: PROJECT_WEB_REFERENCES_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Project web-reference listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save({ projectId, url, title, note = "" } = {}) {
      if (destroyed) return snapshot();
      const validProjectId = validateProjectId(projectId);
      if (!projectExists(validProjectId)) {
        throw new TypeError("Project web reference requires a registered project");
      }
      const validUrl = validateProjectWebUrl(url);
      const validTitle = boundedText(
        title,
        "Project web reference title",
        MAX_PROJECT_WEB_TITLE_LENGTH,
      );
      const validNote = boundedText(
        note,
        "Project web reference note",
        MAX_PROJECT_WEB_NOTE_LENGTH,
        { allowEmpty: true },
      );
      const existingIndex = state.references.findIndex((reference) => (
        reference.projectId === validProjectId && reference.url === validUrl
      ));

      if (existingIndex >= 0) {
        const existing = state.references[existingIndex];
        if (existing.title === validTitle && existing.note === validNote) return snapshot();
        const updatedAt = Math.max(readClock(now), existing.createdAt, existing.updatedAt);
        const references = [...state.references];
        references[existingIndex] = Object.freeze({
          ...existing,
          title: validTitle,
          note: validNote,
          updatedAt,
        });
        replaceState({ nextOrdinal: state.nextOrdinal, references });
        return snapshot();
      }

      if (state.references.length >= MAX_PROJECT_WEB_REFERENCES) {
        throw new RangeError(
          `Project web references support at most ${MAX_PROJECT_WEB_REFERENCES} items`,
        );
      }
      const stamp = readClock(now);
      const reference = Object.freeze({
        id: `project-ref-${state.nextOrdinal}`,
        projectId: validProjectId,
        url: validUrl,
        title: validTitle,
        note: validNote,
        createdAt: stamp,
        updatedAt: stamp,
      });
      replaceState({
        nextOrdinal: state.nextOrdinal + 1,
        references: [reference, ...state.references],
      });
      return snapshot();
    },
    remove(id) {
      if (destroyed) return snapshot();
      const referenceId = validateProjectWebReferenceId(id);
      if (!state.references.some((reference) => reference.id === referenceId)) {
        return snapshot();
      }
      replaceState({
        nextOrdinal: state.nextOrdinal,
        references: state.references.filter((reference) => reference.id !== referenceId),
      });
      return snapshot();
    },
    removeProject(projectId) {
      if (destroyed) return snapshot();
      const validProjectId = validateProjectId(projectId);
      const references = state.references.filter(
        (reference) => reference.projectId !== validProjectId,
      );
      if (references.length === state.references.length) return snapshot();
      replaceState({ nextOrdinal: state.nextOrdinal, references });
      return snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeProjects();
      listeners.clear();
    },
  };

  validateProjectWebReferences(state.references);
  assertProjectWebReferencePort(runtime);
  return Object.freeze(runtime);
}
