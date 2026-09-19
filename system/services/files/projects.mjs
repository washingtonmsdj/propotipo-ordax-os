import {
  MAX_PROJECTS,
  PROJECT_CATALOG_SCHEMA,
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
  validateProjectFilePath,
  validateProjectId,
  validateProjectName,
  validateProjectPath,
} from "../../contracts/project-catalog.mjs";
import {
  assertProjectStore,
  createEmptyProjectStoreState,
  validateProjectStoreState,
} from "../../contracts/project-store.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Project runtime clock must return a non-negative epoch millisecond");
  }
  return value;
}

function sameProjects(left, right) {
  if (left.length !== right.length) return false;
  return left.every((project, index) => {
    const candidate = right[index];
    return project.id === candidate.id
      && project.name === candidate.name
      && project.path === candidate.path
      && project.createdAt === candidate.createdAt
      && project.lastOpenedAt === candidate.lastOpenedAt
      && project.lastFilePath === candidate.lastFilePath;
  });
}

export function createProjectCatalogRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Project runtime requires a clock function");
  }
  const durableStore = store === null ? null : assertProjectStore(store);
  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyProjectStoreState();
  const listeners = new Set();

  if (durableStore) {
    try {
      state = validateProjectStoreState(durableStore.load());
    } catch {
      state = createEmptyProjectStoreState();
      persistence = "session";
    }
  }

  const getSnapshot = () => validateProjectCatalogSnapshot({
    persistence,
    projects: state.projects,
  });

  const emit = () => {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const persist = (nextState) => {
    state = validateProjectStoreState(nextState);
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
    const validated = validateProjectStoreState(nextState);
    if (
      validated.nextOrdinal === state.nextOrdinal
      && sameProjects(validated.projects, state.projects)
    ) {
      return false;
    }
    persist(validated);
    emit();
    return true;
  };

  const port = {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Project catalog listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    create({ name, path } = {}) {
      if (state.projects.length >= MAX_PROJECTS) {
        throw new RangeError(`Project catalog supports at most ${MAX_PROJECTS} projects`);
      }
      const validatedName = validateProjectName(name);
      const validatedPath = validateProjectPath(path);
      if (state.projects.some((project) => project.path === validatedPath)) {
        throw new TypeError("This folder is already registered as a project");
      }
      const timestamp = readClock(now);
      const project = Object.freeze({
        id: `project-${state.nextOrdinal}`,
        name: validatedName,
        path: validatedPath,
        createdAt: timestamp,
        lastOpenedAt: timestamp,
        lastFilePath: null,
      });
      replaceState({
        nextOrdinal: state.nextOrdinal + 1,
        projects: [project, ...state.projects],
      });
      return getSnapshot();
    },
    rename(id, name) {
      const projectId = validateProjectId(id);
      const validatedName = validateProjectName(name);
      const existingIndex = state.projects.findIndex((project) => project.id === projectId);
      if (existingIndex < 0) {
        throw new TypeError("Project id is not registered");
      }
      const existing = state.projects[existingIndex];
      if (existing.name === validatedName) return getSnapshot();
      const updatedProjects = [...state.projects];
      updatedProjects[existingIndex] = Object.freeze({ ...existing, name: validatedName });
      replaceState({
        nextOrdinal: state.nextOrdinal,
        projects: updatedProjects,
      });
      return getSnapshot();
    },
    recordOpened(id) {
      const projectId = validateProjectId(id);
      const existing = state.projects.find((project) => project.id === projectId);
      if (!existing) {
        throw new TypeError("Project id is not registered");
      }
      const timestamp = Math.max(readClock(now), existing.lastOpenedAt, existing.createdAt);
      const updated = Object.freeze({ ...existing, lastOpenedAt: timestamp });
      replaceState({
        nextOrdinal: state.nextOrdinal,
        projects: [
          updated,
          ...state.projects.filter((project) => project.id !== projectId),
        ],
      });
      return getSnapshot();
    },
    recordFileOpened(id, filePath) {
      const projectId = validateProjectId(id);
      const existing = state.projects.find((project) => project.id === projectId);
      if (!existing) {
        throw new TypeError("Project id is not registered");
      }
      const validatedFilePath = validateProjectFilePath(existing.path, filePath);
      const timestamp = Math.max(readClock(now), existing.lastOpenedAt, existing.createdAt);
      const updated = Object.freeze({
        ...existing,
        lastOpenedAt: timestamp,
        lastFilePath: validatedFilePath,
      });
      replaceState({
        nextOrdinal: state.nextOrdinal,
        projects: [
          updated,
          ...state.projects.filter((project) => project.id !== projectId),
        ],
      });
      return getSnapshot();
    },
    remove(id) {
      const projectId = validateProjectId(id);
      replaceState({
        nextOrdinal: state.nextOrdinal,
        projects: state.projects.filter((project) => project.id !== projectId),
      });
      return getSnapshot();
    },
  };

  assertProjectCatalogPort(port);
  return Object.freeze(port);
}
