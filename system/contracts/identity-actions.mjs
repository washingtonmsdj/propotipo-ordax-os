export const IDENTITY_ACTIONS_SCHEMA = "ordax.identity-actions/1";

const KNOWN_ACTIONS = new Set(["sign-in", "sign-out"]);

export function validateIdentityActionsSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Identity actions snapshot must be an object");
  }

  const supportedActions = value.supportedActions ?? [];
  if (!Array.isArray(supportedActions)) {
    throw new TypeError("Identity supportedActions must be an array");
  }

  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (typeof action !== "string" || !KNOWN_ACTIONS.has(action)) {
      throw new TypeError(`Unsupported identity action: ${String(action)}`);
    }
    if (seen.has(action)) {
      throw new TypeError(`Duplicate identity action: ${action}`);
    }
    seen.add(action);
    return action;
  });

  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function isIdentityActionSupported(snapshotValue, action) {
  const snapshot = validateIdentityActionsSnapshot(snapshotValue);
  return snapshot.supportedActions.includes(action);
}

export function assertIdentityActionsPort(port) {
  if (!port || typeof port !== "object") {
    throw new TypeError("Identity actions port is required");
  }
  if (port.schema !== IDENTITY_ACTIONS_SCHEMA) {
    throw new TypeError(`Unsupported identity actions schema: ${String(port.schema)}`);
  }
  if (
    typeof port.getSnapshot !== "function" ||
    typeof port.subscribe !== "function" ||
    typeof port.execute !== "function"
  ) {
    throw new TypeError(
      "Identity actions port must implement getSnapshot(), subscribe(listener) and execute(action)",
    );
  }

  validateIdentityActionsSnapshot(port.getSnapshot());
  return port;
}
