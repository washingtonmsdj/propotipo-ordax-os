export const UPDATE_STATUS_SCHEMA = "ordax.update-status/1";

const UPDATE_PHASES = new Set([
  "idle",
  "checking",
  "fetching",
  "validating",
  "activating",
  "health-wait",
  "rollback",
  "blocked",
  "error",
]);

function optionalNonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError("Update status numeric fields must be bounded non-negative integers");
  }
  return value;
}

function optionalString(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") {
    throw new TypeError("Update status text fields must be strings");
  }
  return value;
}

export function validateUpdateStatusSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Update status snapshot must be an object");
  }
  if (typeof value.sourceSha !== "string" || value.sourceSha.length === 0) {
    throw new TypeError("Update status requires sourceSha");
  }
  if (typeof value.status !== "string" || value.status.length === 0) {
    throw new TypeError("Update status requires status");
  }
  if (typeof value.applyMode !== "string" || value.applyMode.length === 0) {
    throw new TypeError("Update status requires applyMode");
  }
  const phase = optionalString(value.phase, "idle");
  if (!UPDATE_PHASES.has(phase)) {
    throw new TypeError(`Unsupported update phase: ${phase}`);
  }
  return Object.freeze({
    sourceSha: value.sourceSha,
    versionNumber: optionalNonNegativeInteger(value.versionNumber, 0, 1_000_000),
    runtimeSurfaceSha: optionalString(value.runtimeSurfaceSha, value.sourceSha),
    targetSha: optionalString(value.targetSha, ""),
    status: value.status,
    phase,
    applyMode: value.applyMode,
    attemptId: optionalString(value.attemptId, ""),
    bootRefreshRequired: value.bootRefreshRequired === true,
    checkedAt: optionalString(value.checkedAt, "unknown"),
    lastAppliedSha: optionalString(value.lastAppliedSha, ""),
    lastAppliedAt: optionalString(value.lastAppliedAt, "unknown"),
    lastApplyDurationSeconds: optionalNonNegativeInteger(value.lastApplyDurationSeconds, 0, 3600),
    lastStageDurationSeconds: optionalNonNegativeInteger(value.lastStageDurationSeconds, 0, 3600),
    rejectedSha: optionalString(value.rejectedSha, ""),
    lastError: optionalString(value.lastError, ""),
    healthToken: optionalString(value.healthToken, ""),
  });
}

export function assertUpdateStatusPort(port) {
  if (!port || typeof port !== "object" || port.schema !== UPDATE_STATUS_SCHEMA) {
    throw new TypeError("A compatible update-status port is required");
  }
  if (typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("Update-status port must implement getSnapshot() and subscribe()");
  }
  const snapshot = port.getSnapshot();
  if (snapshot !== null) validateUpdateStatusSnapshot(snapshot);
  return port;
}
