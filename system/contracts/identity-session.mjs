export const IDENTITY_SESSION_SCHEMA = "ordax.identity-session/1";

const STATES = new Set(["unavailable", "signed-out", "signed-in"]);

export function validateIdentitySessionSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Identity session snapshot must be an object");
  }

  const state = value.state ?? "unavailable";
  if (!STATES.has(state)) {
    throw new TypeError(`Unsupported identity session state: ${String(state)}`);
  }

  if (state !== "signed-in") {
    return Object.freeze({ state, subjectId: null, displayName: null });
  }

  if (typeof value.subjectId !== "string" || value.subjectId.length === 0) {
    throw new TypeError("Signed-in identity session requires a non-empty subjectId");
  }
  if (typeof value.displayName !== "string" || value.displayName.length === 0) {
    throw new TypeError("Signed-in identity session requires a non-empty displayName");
  }

  return Object.freeze({
    state,
    subjectId: value.subjectId,
    displayName: value.displayName,
  });
}

export function assertIdentitySessionPort(port) {
  if (!port || typeof port !== "object") {
    throw new TypeError("Identity session port is required");
  }
  if (port.schema !== IDENTITY_SESSION_SCHEMA) {
    throw new TypeError(`Unsupported identity session schema: ${String(port.schema)}`);
  }
  if (typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("Identity session port must implement getSnapshot() and subscribe(listener)");
  }

  validateIdentitySessionSnapshot(port.getSnapshot());
  return port;
}
