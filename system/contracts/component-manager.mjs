import {
  COMPONENT_MANIFEST_SCHEMA,
  defineComponentManifest,
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import { validateComponentStateEntry } from "./component-state-store.mjs";

export const COMPONENT_MANAGER_SCHEMA = "ordax.component-manager/1";
export const COMPONENT_MANAGER_SNAPSHOT_SCHEMA = "ordax.component-manager-snapshot/1";

export function validateManagedComponent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Managed component must be an object");
  }
  const manifest = defineComponentManifest(value.manifest);
  if (manifest.schema !== COMPONENT_MANIFEST_SCHEMA) {
    throw new TypeError("Managed component manifest is invalid");
  }
  const state = validateComponentStateEntry(manifest.id, value.state);
  if (typeof value.independentUpdate !== "boolean") {
    throw new TypeError("Managed component independentUpdate must be boolean");
  }
  if (value.independentUpdate !== (manifest.releaseMode === "component-slot")) {
    throw new TypeError("Managed component independentUpdate conflicts with manifest");
  }
  return Object.freeze({ manifest, state, independentUpdate: value.independentUpdate });
}

export function validateComponentManagerSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component manager snapshot must be an object");
  }
  if (value.schema !== COMPONENT_MANAGER_SNAPSHOT_SCHEMA) {
    throw new TypeError("Unsupported component manager snapshot schema");
  }
  if (!["device", "session"].includes(value.persistence)) {
    throw new TypeError("Component manager persistence must be device or session");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Component manager revision is invalid");
  }
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 128) {
    throw new TypeError("Component manager snapshot must contain a bounded component list");
  }
  const components = value.components.map(validateManagedComponent);
  if (new Set(components.map((component) => component.manifest.id)).size !== components.length) {
    throw new TypeError("Managed component ids must be unique");
  }
  return Object.freeze({
    schema: COMPONENT_MANAGER_SNAPSHOT_SCHEMA,
    persistence: value.persistence,
    revision: value.revision,
    components: Object.freeze(components),
  });
}

export function assertComponentManager(port) {
  if (!port || typeof port !== "object" || port.schema !== COMPONENT_MANAGER_SCHEMA) {
    throw new TypeError("A compatible component manager is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "stageCandidate",
    "markPendingHealthy",
    "promotePending",
    "rejectPending",
    "rollback",
    "setCurrentHealth",
    "destroy",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Component manager must implement ${method}()`);
    }
  }
  validateComponentManagerSnapshot(port.getSnapshot());
  return port;
}

export { validateComponentId, validateComponentVersion };
