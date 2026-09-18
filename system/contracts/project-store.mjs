import {
  MAX_PROJECTS,
  projectOrdinal,
  validateProjectEntries,
} from "./project-catalog.mjs";

export const PROJECT_STORE_SCHEMA = "ordax.project-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function createEmptyProjectStoreState() {
  return Object.freeze({
    nextOrdinal: 1,
    projects: Object.freeze([]),
  });
}

export function validateProjectStoreState(value) {
  if (value === undefined || value === null) return createEmptyProjectStoreState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project store state must be an object");
  }
  const projects = validateProjectEntries(value.projects);
  if (projects.length > MAX_PROJECTS) {
    throw new TypeError("Project store contains too many projects");
  }
  const highestOrdinal = projects.reduce(
    (highest, project) => Math.max(highest, projectOrdinal(project.id)),
    0,
  );
  if (
    !Number.isSafeInteger(value.nextOrdinal)
    || value.nextOrdinal < 1
    || value.nextOrdinal <= highestOrdinal
  ) {
    throw new TypeError("Project store nextOrdinal must exceed all project ids");
  }
  return Object.freeze({
    nextOrdinal: value.nextOrdinal,
    projects,
  });
}

export function assertProjectStore(store) {
  if (!store || typeof store !== "object" || store.schema !== PROJECT_STORE_SCHEMA) {
    throw new TypeError("A compatible project store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Project store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Project store must implement load() and save(state)");
  }
  validateProjectStoreState(store.load());
  return store;
}
