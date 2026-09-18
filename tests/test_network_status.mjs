import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_STATUS_SCHEMA,
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../system/contracts/network-status.mjs";
import { summarizeNetworkStatus } from "../system/surface/ui/network-tray-controls.mjs";

test("network status validates bounded interface observability", () => {
  const snapshot = validateNetworkStatusSnapshot({
    interfaces: [
      { name: "eth0", kind: "ethernet", state: "connected", signalDbm: null },
      { name: "wlan0", kind: "wifi", state: "connected", signalDbm: -48 },
    ],
  });
  assert.equal(snapshot.interfaces.length, 2);
  assert.equal(snapshot.interfaces[1].signalDbm, -48);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.interfaces));
});

test("network status rejects secrets-shaped extras only by not preserving them", () => {
  const snapshot = validateNetworkStatusSnapshot({
    interfaces: [
      {
        name: "wlan0",
        kind: "wifi",
        state: "connected",
        signalDbm: -52,
        ssid: "must-not-cross-contract",
        password: "must-not-cross-contract",
      },
    ],
  });
  assert.deepEqual(Object.keys(snapshot.interfaces[0]), ["name", "kind", "state", "signalDbm"]);
});

test("network status rejects invalid signals, names, duplicates, and non-wifi signal", () => {
  assert.throws(() =>
    validateNetworkStatusSnapshot({
      interfaces: [{ name: "../wlan0", kind: "wifi", state: "connected", signalDbm: -40 }],
    }),
  );
  assert.throws(() =>
    validateNetworkStatusSnapshot({
      interfaces: [{ name: "wlan0", kind: "wifi", state: "connected", signalDbm: 20 }],
    }),
  );
  assert.throws(() =>
    validateNetworkStatusSnapshot({
      interfaces: [{ name: "eth0", kind: "ethernet", state: "connected", signalDbm: -30 }],
    }),
  );
  assert.throws(() =>
    validateNetworkStatusSnapshot({
      interfaces: [
        { name: "wlan0", kind: "wifi", state: "connected", signalDbm: -40 },
        { name: "wlan0", kind: "wifi", state: "connected", signalDbm: -42 },
      ],
    }),
  );
});

test("network tray prefers connected Wi-Fi and maps signal strength", () => {
  assert.deepEqual(
    summarizeNetworkStatus({
      interfaces: [
        { name: "eth0", kind: "ethernet", state: "connected", signalDbm: null },
        { name: "wlan0", kind: "wifi", state: "connected", signalDbm: -47 },
      ],
    }),
    {
      kind: "wifi",
      state: "connected",
      signalLevel: 4,
      label: "Wi-Fi",
      title: "Wi-Fi conectado · sinal forte",
    },
  );
});

test("network tray falls back to cable and never invents connection", () => {
  assert.deepEqual(
    summarizeNetworkStatus({
      interfaces: [
        { name: "eth0", kind: "ethernet", state: "connected", signalDbm: null },
        { name: "wlan0", kind: "wifi", state: "disconnected", signalDbm: null },
      ],
    }),
    {
      kind: "ethernet",
      state: "connected",
      signalLevel: 0,
      label: "Cabo",
      title: "Rede por cabo conectada",
    },
  );
  assert.equal(
    summarizeNetworkStatus({
      interfaces: [
        { name: "wlan0", kind: "wifi", state: "disconnected", signalDbm: null },
      ],
    }).label,
    "Wi-Fi desconectado",
  );
});

test("network status port remains read-only", () => {
  const port = {
    schema: NETWORK_STATUS_SCHEMA,
    async read() {
      return { interfaces: [] };
    },
  };
  assert.equal(assertNetworkStatusPort(port), port);
  assert.equal("connect" in port, false);
  assert.equal("forget" in port, false);
});
