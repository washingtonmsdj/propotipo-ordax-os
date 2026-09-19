import {
  MAX_PROJECT_WEB_REFERENCES,
  projectWebReferenceOrdinal,
  validateProjectWebReferences,
} from "./project-web-references.mjs";

export const PROJECT_WEB_REFERENCE_STORE_SCHEMA = "ordax.project-web-reference-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function createEmptyProjectWebReferenceStoreState() {
  return Object.freeze({
    nextOrdinal: 1,
    references: Object.freeze([]),
  });
}

export function validateProjectWebReferenceStoreState(value) {
  if (value === undefined || value === null) {
    return createEmptyProjectWebReferenceStoreState();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project web-reference store state must be an object");
  }
  const references = validateProjectWebReferences(value.references);
  if (references.length > MAX_PROJECT_WEB_REFERENCES) {
    throw new TypeError("Project web-reference store contains too many items");
  }
  const highestOrdinal = references.reduce(
    (highest, reference) => Math.max(highest, projectWebReferenceOrdinal(reference.id)),
    0,
  );
  if (
    !Number.isSafeInteger(value.nextOrdinal)
    || value.nextOrdinal < 1
    || value.nextOrdinal <= highestOrdinal
  ) {
    throw new TypeError("Project web-reference store nextOrdinal must exceed all ids");
  }
  return Object.freeze({
    nextOrdinal: value.nextOrdinal,
    references,
  });
}

export function assertProjectWebReferenceStore(store) {
  if (
    !store
    || store.schema !== PROJECT_WEB_REFERENCE_STORE_SCHEMA
    || !STORE_SCOPES.has(store.scope)
  ) {
    throw new TypeError("A compatible project web-reference store is required");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Project web-reference store must implement load() and save(state)");
  }
  validateProjectWebReferenceStoreState(store.load());
  return store;
}
