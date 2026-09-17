export const POWER_ACTIONS_SCHEMA = "ordax.power-actions/1";

const KNOWN_ACTIONS = new Set(["restart", "shutdown"]);

export function validatePowerActionsSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Power actions snapshot must be an object");
  }

  const supportedActions = value.supportedActions ?? [];
  if (!Array.isArray(supportedActions)) {
    throw new TypeError("Power supportedActions must be an array");
  }

  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (typeof action !== "string" || !KNOWN_ACTIONS.has(action)) {
      throw new TypeError(`Unsupported power action: ${String(action)}`);
    }
    if (seen.has(action)) {
      throw new TypeError(`Duplicate power action: ${action}`);
    }
    seen.add(action);
    return action;
  });

  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function isPowerActionSupported(snapshotValue, action) {
  const snapshot = validatePowerActionsSnapshot(snapshotValue);
  return snapshot.supportedActions.includes(action);
}

export function assertPowerActionsPort(port) {
  if (!port || typeof port !== "object") {
    throw new TypeError("Power actions port is required");
  }
  if (port.schema !== POWER_ACTIONS_SCHEMA) {
    throw new TypeError(`Unsupported power actions schema: ${String(port.schema)}`);
  }
  if (
    typeof port.getSnapshot !== "function" ||
    typeof port.subscribe !== "function" ||
    typeof port.execute !== "function"
  ) {
    throw new TypeError(
      "Power actions port must implement getSnapshot(), subscribe(listener) and execute(action)",
    );
  }

  validatePowerActionsSnapshot(port.getSnapshot());
  return port;
}
