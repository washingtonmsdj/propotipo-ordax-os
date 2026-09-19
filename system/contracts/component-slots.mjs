export const COMPONENT_SLOTS_SCHEMA = "ordax.component-slots/1";
export const COMPONENT_SLOT_SNAPSHOT_SCHEMA = "ordax.component-slot-snapshot/1";

const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA40_RE = /^[0-9a-f]{40}$/;

export function validateComponentSlotId(value) {
  if (typeof value !== "string" || !COMPONENT_ID_RE.test(value)) {
    throw new TypeError("Component slot id is invalid");
  }
  return value;
}

export function validateComponentSlotVersion(value, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || !VERSION_RE.test(value)) {
    throw new TypeError("Component slot version is invalid");
  }
  return value;
}

function validateRole(value, componentId) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component slot role must be an object or null");
  }
  const version = validateComponentSlotVersion(value.version);
  if (typeof value.verified !== "boolean") {
    throw new TypeError("Component slot role verified must be boolean");
  }
  if (!value.verified) {
    if (value.entrypointUrl !== null) {
      throw new TypeError("Unverified component slot cannot expose an entrypoint");
    }
    return Object.freeze({
      version,
      verified: false,
      entrypointUrl: null,
    });
  }
  const expectedPrefix = `/__ordax/component/${componentId}/${version}/system/`;
  if (
    typeof value.entrypointUrl !== "string"
    || !value.entrypointUrl.startsWith(expectedPrefix)
  ) {
    throw new TypeError("Verified component slot entrypoint URL is invalid");
  }
  if (typeof value.sourceCommit !== "string" || !SHA40_RE.test(value.sourceCommit)) {
    throw new TypeError("Verified component slot source commit is invalid");
  }
  if (
    !Number.isSafeInteger(value.releaseSequence)
    || value.releaseSequence < 1
  ) {
    throw new TypeError("Verified component slot release sequence is invalid");
  }
  return Object.freeze({
    version,
    verified: true,
    entrypointUrl: value.entrypointUrl,
    sourceCommit: value.sourceCommit,
    releaseSequence: value.releaseSequence,
  });
}

export function validateComponentSlotSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component slot snapshot must be an object");
  }
  if (value.$schema !== "ordax.native-component-slot/1") {
    throw new TypeError("Unsupported Native component slot snapshot");
  }
  const componentId = validateComponentSlotId(value.componentId);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Component slot revision is invalid");
  }
  return Object.freeze({
    schema: COMPONENT_SLOT_SNAPSHOT_SCHEMA,
    componentId,
    revision: value.revision,
    current: validateRole(value.current, componentId),
    previous: validateRole(value.previous, componentId),
    pending: validateRole(value.pending, componentId),
    rejectedVersion: validateComponentSlotVersion(
      value.rejectedVersion,
      { optional: true },
    ),
  });
}

export function assertComponentSlotsPort(port) {
  if (!port || port.schema !== COMPONENT_SLOTS_SCHEMA) {
    throw new TypeError("A compatible component slots port is required");
  }
  for (const method of ["getSnapshot", "prepare", "promote", "reject", "rollback"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Component slots port must implement ${method}()`);
    }
  }
  return port;
}
