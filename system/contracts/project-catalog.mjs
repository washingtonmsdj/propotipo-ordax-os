import { validateFileSpacePath } from "./file-space.mjs";

export const PROJECT_CATALOG_SCHEMA = "ordax.project-catalog/1";
export const MAX_PROJECTS = 32;
export const MAX_PROJECT_NAME_LENGTH = 80;

const PROJECT_ID_RE = /^project-[1-9][0-9]*$/;
const PERSISTENCE_SCOPES = new Set(["device", "session"]);

export function validateProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_RE.test(value)) {
    throw new TypeError("Project id is invalid");
  }
  return value;
}

export function projectOrdinal(value) {
  const id = validateProjectId(value);
  const ordinal = Number(id.slice("project-".length));
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError("Project id ordinal is invalid");
  }
  return ordinal;
}

export function validateProjectName(value) {
  if (typeof value !== "string") {
    throw new TypeError("Project name must be a string");
  }
  const name = value.trim();
  if (
    name.length < 1
    || name.length > MAX_PROJECT_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new TypeError("Project name must be a bounded visible string");
  }
  return name;
}

export function validateProjectPath(value) {
  const path = validateFileSpacePath(value);
  if (path === "/") {
    throw new TypeError("Project path must identify a folder below the logical root");
  }
  return path;
}

function validateTimestamp(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Project ${field} must be a non-negative epoch millisecond`);
  }
  return value;
}

export function validateProjectEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project entry must be an object");
  }
  const createdAt = validateTimestamp(value.createdAt, "createdAt");
  const lastOpenedAt = validateTimestamp(value.lastOpenedAt, "lastOpenedAt");
  if (lastOpenedAt < createdAt) {
    throw new TypeError("Project lastOpenedAt cannot precede createdAt");
  }
  return Object.freeze({
    id: validateProjectId(value.id),
    name: validateProjectName(value.name),
    path: validateProjectPath(value.path),
    createdAt,
    lastOpenedAt,
  });
}

export function validateProjectEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_PROJECTS) {
    throw new TypeError(`Project entries must contain at most ${MAX_PROJECTS} items`);
  }
  const projects = value.map(validateProjectEntry);
  const ids = new Set(projects.map((project) => project.id));
  const paths = new Set(projects.map((project) => project.path));
  if (ids.size !== projects.length) {
    throw new TypeError("Project entries must have unique ids");
  }
  if (paths.size !== projects.length) {
    throw new TypeError("Project entries must have unique logical paths");
  }
  return Object.freeze(projects);
}

export function validateProjectCatalogSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project catalog snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Project catalog persistence must be device or session");
  }
  return Object.freeze({
    persistence: value.persistence,
    projects: validateProjectEntries(value.projects),
  });
}

export function assertProjectCatalogPort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROJECT_CATALOG_SCHEMA) {
    throw new TypeError("A compatible project-catalog port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "create", "rename", "recordOpened", "remove"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Project-catalog port must implement ${method}()`);
    }
  }
  validateProjectCatalogSnapshot(port.getSnapshot());
  return port;
}
