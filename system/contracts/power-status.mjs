export const POWER_STATUS_SCHEMA = "ordax.power-status/1";

const BATTERY_STATES = new Set([
  "charging",
  "discharging",
  "full",
  "not-charging",
  "unknown",
]);

function validateBattery(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new TypeError("Power status battery must be null or an object");
  }
  if (!Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100) {
    throw new TypeError("Power status battery percent must be an integer from 0 to 100");
  }
  if (!BATTERY_STATES.has(value.state)) {
    throw new TypeError("Power status battery state is invalid");
  }
  return Object.freeze({
    percent: value.percent,
    state: value.state,
  });
}

export function validatePowerStatusSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Power status snapshot must be an object");
  }
  const externalPower =
    value.externalPower === null || typeof value.externalPower === "boolean"
      ? value.externalPower
      : null;
  return Object.freeze({
    battery: validateBattery(value.battery ?? null),
    externalPower,
  });
}

export function assertPowerStatusPort(port) {
  if (!port || typeof port !== "object" || port.schema !== POWER_STATUS_SCHEMA) {
    throw new TypeError("A compatible power-status port is required");
  }
  if (typeof port.read !== "function") {
    throw new TypeError("Power-status port must implement read()");
  }
  return port;
}
