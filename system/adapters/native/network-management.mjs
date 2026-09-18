import {
  NETWORK_MANAGEMENT_SCHEMA,
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
  validateWifiCredentials,
} from "../../contracts/network-management.mjs";

const SESSION_ENDPOINT = "/__ordax/native/session";
const NETWORK_ENDPOINT = "/__ordax/native/network-management";
const TOKEN_HEADER = "X-OrdaX-Network-Token";

async function readNetworkToken(windowRef) {
  const response = await windowRef.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native network session failed: ${response.status}`);
  const payload = await response.json();
  if (typeof payload.networkToken !== "string" || payload.networkToken.length < 16) {
    throw new Error("Native network token is unavailable");
  }
  return payload.networkToken;
}

export async function createNativeNetworkManagement(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native network management adapter requires window.fetch");
  }

  const token = await readNetworkToken(windowRef);

  const request = async (method, action = null, payload = {}) => {
    const options = {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { [TOKEN_HEADER]: token },
    };
    if (method === "POST") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ action, ...payload });
    }
    const response = await windowRef.fetch(NETWORK_ENDPOINT, options);
    if (!response.ok) {
      const error = new Error(`Native network management request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return validateNetworkManagementSnapshot(await response.json());
  };

  const port = {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() {
      return request("GET");
    },
    scan() {
      return request("POST", "scan");
    },
    connect(credentials) {
      const value = validateWifiCredentials(credentials);
      return request("POST", "connect", value);
    },
    disconnect() {
      return request("POST", "disconnect");
    },
    forget() {
      return request("POST", "forget");
    },
    reconnect() {
      return request("POST", "reconnect");
    },
  };

  assertNetworkManagementPort(port);
  await port.status();
  return Object.freeze(port);
}
