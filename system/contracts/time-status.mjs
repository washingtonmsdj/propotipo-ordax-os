export const TIME_STATUS_SCHEMA = "ordax.time-status/1";

const SYNC_STATES = new Set(["running", "unavailable"]);

export function validateTimeStatusSnapshot(value) {
  if (!value || typeof value !== "object" || !SYNC_STATES.has(value.automaticSync)) {
    throw new TypeError("Time status snapshot is invalid");
  }
  return Object.freeze({ automaticSync: value.automaticSync });
}

export function assertTimeStatusPort(port) {
  if (!port || typeof port !== "object" || port.schema !== TIME_STATUS_SCHEMA) {
    throw new TypeError("A compatible time-status port is required");
  }
  if (typeof port.read !== "function") {
    throw new TypeError("Time-status port must implement read()");
  }
  return port;
}
