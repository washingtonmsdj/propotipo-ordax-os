import { validateProjectId } from "./project-catalog.mjs";

export const PROJECT_WEB_REFERENCES_SCHEMA = "ordax.project-web-references/1";
export const MAX_PROJECT_WEB_REFERENCES = 512;
export const MAX_PROJECT_WEB_TITLE_LENGTH = 256;
export const MAX_PROJECT_WEB_NOTE_LENGTH = 4096;
export const MAX_PROJECT_WEB_URL_LENGTH = 4096;

const REFERENCE_ID_RE = /^project-ref-[1-9][0-9]*$/;
const PERSISTENCE_SCOPES = new Set(["device", "session"]);

function boundedVisibleText(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return text;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

export function validateProjectWebReferenceId(value) {
  if (typeof value !== "string" || !REFERENCE_ID_RE.test(value)) {
    throw new TypeError("Project web reference id is invalid");
  }
  return value;
}

export function projectWebReferenceOrdinal(value) {
  const id = validateProjectWebReferenceId(value);
  const ordinal = Number(id.slice("project-ref-".length));
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError("Project web reference ordinal is invalid");
  }
  return ordinal;
}

export function validateProjectWebUrl(value) {
  const source = boundedVisibleText(
    value,
    "Project web reference URL",
    MAX_PROJECT_WEB_URL_LENGTH,
  );
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("Project web reference URL is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError("Project web reference URL must use http or https");
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new TypeError("Project web reference URL contains unsupported credentials or host");
  }
  if (parsed.href.length > MAX_PROJECT_WEB_URL_LENGTH) {
    throw new TypeError("Project web reference URL is too long");
  }
  return parsed.href;
}

export function validateProjectWebReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project web reference must be an object");
  }
  const createdAt = timestamp(value.createdAt, "Project web reference createdAt");
  const updatedAt = timestamp(value.updatedAt, "Project web reference updatedAt");
  if (updatedAt < createdAt) {
    throw new TypeError("Project web reference updatedAt cannot precede createdAt");
  }
  return Object.freeze({
    id: validateProjectWebReferenceId(value.id),
    projectId: validateProjectId(value.projectId),
    url: validateProjectWebUrl(value.url),
    title: boundedVisibleText(
      value.title,
      "Project web reference title",
      MAX_PROJECT_WEB_TITLE_LENGTH,
    ),
    note: boundedVisibleText(
      value.note ?? "",
      "Project web reference note",
      MAX_PROJECT_WEB_NOTE_LENGTH,
      { allowEmpty: true },
    ),
    createdAt,
    updatedAt,
  });
}

export function validateProjectWebReferences(value) {
  if (!Array.isArray(value) || value.length > MAX_PROJECT_WEB_REFERENCES) {
    throw new TypeError(
      `Project web references must contain at most ${MAX_PROJECT_WEB_REFERENCES} items`,
    );
  }
  const references = value.map(validateProjectWebReference);
  const ids = new Set(references.map((reference) => reference.id));
  if (ids.size !== references.length) {
    throw new TypeError("Project web reference ids must be unique");
  }
  const keys = new Set(
    references.map((reference) => `${reference.projectId}\u0000${reference.url}`),
  );
  if (keys.size !== references.length) {
    throw new TypeError("A project can contain only one saved reference per URL");
  }
  return Object.freeze(references);
}

export function validateProjectWebReferenceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project web reference snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Project web reference persistence must be device or session");
  }
  return Object.freeze({
    persistence: value.persistence,
    references: validateProjectWebReferences(value.references),
  });
}

export function assertProjectWebReferencePort(port) {
  if (!port || port.schema !== PROJECT_WEB_REFERENCES_SCHEMA) {
    throw new TypeError("A compatible project web-reference port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "save",
    "remove",
    "removeProject",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Project web-reference port must implement ${method}()`);
    }
  }
  validateProjectWebReferenceSnapshot(port.getSnapshot());
  return port;
}
