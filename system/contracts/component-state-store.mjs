import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const COMPONENT_STATE_SCHEMA = "ordax.component-state/1";
export const COMPONENT_STATE_STORE_SCHEMA = "ordax.component-state-store/1";

const HEALTH_STATES = new Set(["unknown", "healthy", "failed"]);

function optionalVersion(value, label) {
  if (value === null) return null;
  try {
    return validateComponentVersion(value);
  } catch {
    throw new TypeError(`${label} must be null or a semantic version`);
  }
}

function health(value, label) {
  if (!HEALTH_STATES.has(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Component state updatedAt must be a non-negative epoch millisecond");
  }
  return value;
}

export function createEmptyComponentState() {
  return Object.freeze({
    schema: COMPONENT_STATE_SCHEMA,
    revision: 0,
    components: Object.freeze({}),
  });
}

export function validateComponentStateEntry(componentId, value) {
  validateComponentId(componentId);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Component state for ${componentId} must be an object`);
  }
  return Object.freeze({
    currentVersion: validateComponentVersion(value.currentVersion),
    previousVersion: optionalVersion(value.previousVersion, "previousVersion"),
    pendingVersion: optionalVersion(value.pendingVersion, "pendingVersion"),
    rejectedVersion: optionalVersion(value.rejectedVersion, "rejectedVersion"),
    currentHealth: health(value.currentHealth, "currentHealth"),
    pendingHealth: health(value.pendingHealth, "pendingHealth"),
    updatedAt: epoch(value.updatedAt),
  });
}

export function validateComponentState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component state must be an object");
  }
  if (value.schema !== COMPONENT_STATE_SCHEMA) {
    throw new TypeError("Unsupported component state schema");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Component state revision must be a non-negative integer");
  }
  if (!value.components || typeof value.components !== "object" || Array.isArray(value.components)) {
    throw new TypeError("Component state components must be an object");
  }
  const entries = Object.entries(value.components);
  if (entries.length > 128) {
    throw new TypeError("Component state contains too many entries");
  }
  const components = {};
  for (const [componentId, entry] of entries) {
    validateComponentId(componentId);
    components[componentId] = validateComponentStateEntry(componentId, entry);
  }
  return Object.freeze({
    schema: COMPONENT_STATE_SCHEMA,
    revision: value.revision,
    components: Object.freeze(components),
  });
}

export function assertComponentStateStore(store) {
  if (
    !store
    || typeof store !== "object"
    || store.schema !== COMPONENT_STATE_STORE_SCHEMA
  ) {
    throw new TypeError("A compatible component state store is required");
  }
  if (!["device", "session"].includes(store.scope)) {
    throw new TypeError("Component state store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Component state store must implement load() and save(state)");
  }
  const loaded = store.load();
  if (loaded !== null && loaded !== undefined) {
    validateComponentState(loaded);
  }
  return store;
}
