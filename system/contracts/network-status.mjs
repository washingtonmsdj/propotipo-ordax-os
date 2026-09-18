export const NETWORK_STATUS_SCHEMA = "ordax.network-status/1";

const INTERFACE_KINDS = new Set(["wifi", "ethernet", "other"]);
const LINK_STATES = new Set(["connected", "disconnected", "unknown"]);
const INTERFACE_NAME_RE = /^[A-Za-z0-9_.:-]{1,32}$/;
const MAX_INTERFACES = 64;

function validateSignalDbm(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < -200 || value > 0) {
    throw new TypeError("Network signalDbm must be null or an integer between -200 and 0");
  }
  return value;
}

function validateInterface(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Network interface must be an object");
  }
  if (typeof value.name !== "string" || !INTERFACE_NAME_RE.test(value.name)) {
    throw new TypeError("Network interface name is invalid");
  }
  if (!INTERFACE_KINDS.has(value.kind)) {
    throw new TypeError("Network interface kind is invalid");
  }
  if (!LINK_STATES.has(value.state)) {
    throw new TypeError("Network interface state is invalid");
  }
  const signalDbm = validateSignalDbm(value.signalDbm);
  if (value.kind !== "wifi" && signalDbm !== null) {
    throw new TypeError("Only Wi-Fi interfaces may report signalDbm");
  }
  return Object.freeze({
    name: value.name,
    kind: value.kind,
    state: value.state,
    signalDbm,
  });
}

export function validateNetworkStatusSnapshot(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.interfaces)) {
    throw new TypeError("Network status snapshot must contain interfaces");
  }
  if (value.interfaces.length > MAX_INTERFACES) {
    throw new TypeError("Network status snapshot contains too many interfaces");
  }
  const interfaces = value.interfaces.map(validateInterface);
  const names = new Set(interfaces.map((entry) => entry.name));
  if (names.size !== interfaces.length) {
    throw new TypeError("Network status interface names must be unique");
  }
  return Object.freeze({ interfaces: Object.freeze(interfaces) });
}

export function assertNetworkStatusPort(port) {
  if (!port || typeof port !== "object" || port.schema !== NETWORK_STATUS_SCHEMA) {
    throw new TypeError("A compatible network-status port is required");
  }
  if (typeof port.read !== "function") {
    throw new TypeError("Network-status port must implement read()");
  }
  return port;
}
