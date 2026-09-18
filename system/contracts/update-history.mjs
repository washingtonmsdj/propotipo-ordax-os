export const UPDATE_HISTORY_SCHEMA = "ordax.update-history/1";

const SHA_RE = /^[0-9a-f]{40}$/;
const APPLY_MODES = new Set(["none", "reload", "surface-restart", "supervisor-restart", "initial"]);
const RESULTS = new Set(["applied", "rolled-back"]);
const MAX_RELEASES = 80;
const MAX_APPLICATIONS = 200;

function versionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new TypeError("Update history versionNumber must be a positive safe integer");
  }
  return value;
}

function sha(value) {
  if (typeof value !== "string" || !SHA_RE.test(value)) {
    throw new TypeError("Update history sourceSha must be a full lowercase Git SHA");
  }
  return value;
}

function boundedText(value, field, maxLength = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`Update history ${field} must be a bounded non-empty string`);
  }
  return value;
}

function duration(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3600) {
    throw new TypeError(`Update history ${field} must be an integer between 0 and 3600`);
  }
  return value;
}

function validateRelease(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Update history release must be an object");
  }
  return Object.freeze({
    versionNumber: versionNumber(value.versionNumber),
    sourceSha: sha(value.sourceSha),
    releasedAt: boundedText(value.releasedAt, "releasedAt", 64),
    title: boundedText(value.title, "title", 200),
  });
}

function validateApplication(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Update history application must be an object");
  }
  if (!APPLY_MODES.has(value.applyMode)) {
    throw new TypeError("Update history applyMode is invalid");
  }
  if (!RESULTS.has(value.result)) {
    throw new TypeError("Update history result is invalid");
  }
  return Object.freeze({
    versionNumber: versionNumber(value.versionNumber),
    sourceSha: sha(value.sourceSha),
    appliedAt: boundedText(value.appliedAt, "appliedAt", 64),
    applyMode: value.applyMode,
    result: value.result,
    applyDurationSeconds: duration(value.applyDurationSeconds, "applyDurationSeconds"),
    stageDurationSeconds: duration(value.stageDurationSeconds, "stageDurationSeconds"),
  });
}

export function validateUpdateHistorySnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Update history snapshot must be an object");
  }
  if (!Array.isArray(value.releases) || value.releases.length > MAX_RELEASES) {
    throw new TypeError("Update history releases must be a bounded array");
  }
  if (!Array.isArray(value.applications) || value.applications.length > MAX_APPLICATIONS) {
    throw new TypeError("Update history applications must be a bounded array");
  }
  return Object.freeze({
    releases: Object.freeze(value.releases.map(validateRelease)),
    applications: Object.freeze(value.applications.map(validateApplication)),
  });
}

export function assertUpdateHistoryPort(port) {
  if (!port || typeof port !== "object" || port.schema !== UPDATE_HISTORY_SCHEMA) {
    throw new TypeError("A compatible update-history port is required");
  }
  if (typeof port.list !== "function") {
    throw new TypeError("Update-history port must implement list()");
  }
  return port;
}
