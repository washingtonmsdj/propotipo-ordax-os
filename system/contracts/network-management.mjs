export const NETWORK_MANAGEMENT_SCHEMA = "ordax.network-management/1";

const INTERFACE_RE = /^[A-Za-z0-9_.:-]{1,32}$/;
const SECURITY_MODES = new Set(["wpa-psk"]);
const MAX_NETWORKS = 32;

function optionalSsid(value, field) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new TypeError(`Network management ${field} must be null or a bounded string`);
  }
  return value;
}

function validateNetwork(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Network management network must be an object");
  }
  const ssid = optionalSsid(value.ssid, "ssid");
  if (ssid === null) throw new TypeError("Network management SSID is required");
  if (!Number.isInteger(value.signalDbm) || value.signalDbm < -200 || value.signalDbm > 0) {
    throw new TypeError("Network management signalDbm is invalid");
  }
  if (!SECURITY_MODES.has(value.security)) {
    throw new TypeError("Network management security mode is invalid");
  }
  return Object.freeze({
    ssid,
    signalDbm: value.signalDbm,
    security: value.security,
    connected: value.connected === true,
    saved: value.saved === true,
  });
}

export function validateNetworkManagementSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Network management snapshot must be an object");
  }
  if (typeof value.wifiInterface !== "string" || !INTERFACE_RE.test(value.wifiInterface)) {
    throw new TypeError("Network management wifiInterface is invalid");
  }
  if (!Array.isArray(value.networks) || value.networks.length > MAX_NETWORKS) {
    throw new TypeError("Network management networks must be a bounded array");
  }
  const networks = value.networks.map(validateNetwork);
  const names = new Set(networks.map((entry) => entry.ssid));
  if (names.size !== networks.length) {
    throw new TypeError("Network management SSIDs must be unique");
  }
  return Object.freeze({
    wifiInterface: value.wifiInterface,
    currentSsid: optionalSsid(value.currentSsid ?? null, "currentSsid"),
    savedSsid: optionalSsid(value.savedSsid ?? null, "savedSsid"),
    networks: Object.freeze(networks),
  });
}

export function validateWifiCredentials(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Wi-Fi credentials must be an object");
  }
  const ssid = optionalSsid(value.ssid, "ssid");
  if (ssid === null) throw new TypeError("Wi-Fi SSID is required");
  if (typeof value.password !== "string" || value.password.length < 8 || value.password.length > 128) {
    throw new TypeError("Wi-Fi password must be a bounded string");
  }
  return Object.freeze({ ssid, password: value.password });
}

export function assertNetworkManagementPort(port) {
  if (!port || typeof port !== "object" || port.schema !== NETWORK_MANAGEMENT_SCHEMA) {
    throw new TypeError("A compatible network-management port is required");
  }
  for (const method of ["status", "scan", "connect", "disconnect", "forget", "reconnect"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Network-management port must implement ${method}()`);
    }
  }
  return port;
}
