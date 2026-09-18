import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MANAGEMENT_SCHEMA,
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
  validateWifiCredentials,
} from "../system/contracts/network-management.mjs";

test("network management validates bounded Wi-Fi snapshots", () => {
  const snapshot = validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: "Casa",
    savedSsid: "Casa",
    networks: [
      { ssid: "Casa", signalDbm: -42, security: "wpa-psk", connected: true, saved: true },
      { ssid: "Escritório", signalDbm: -61, security: "wpa-psk", connected: false, saved: false },
    ],
  });
  assert.equal(snapshot.networks.length, 2);
  assert.equal(snapshot.currentSsid, "Casa");
  assert.ok(Object.isFrozen(snapshot.networks));
});

test("network management credentials stay input-only", () => {
  const credentials = validateWifiCredentials({ ssid: "Casa", password: "segredo123" });
  assert.equal(credentials.password, "segredo123");
  const snapshot = validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: null,
    savedSsid: "Casa",
    networks: [],
    password: "must-not-cross-snapshot",
  });
  assert.equal("password" in snapshot, false);
});

test("network management rejects duplicates and invalid credentials", () => {
  assert.throws(() => validateWifiCredentials({ ssid: "Casa", password: "curta" }));
  assert.throws(() => validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: null,
    savedSsid: null,
    networks: [
      { ssid: "Casa", signalDbm: -40, security: "wpa-psk" },
      { ssid: "Casa", signalDbm: -50, security: "wpa-psk" },
    ],
  }));
});

test("network management port has explicit bounded actions", () => {
  const port = {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() {},
    scan() {},
    connect() {},
    disconnect() {},
    forget() {},
    reconnect() {},
  };
  assert.equal(assertNetworkManagementPort(port), port);
  assert.equal("shell" in port, false);
});
