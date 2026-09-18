import assert from "node:assert/strict";
import test from "node:test";

import { NETWORK_MANAGEMENT_SCHEMA } from "../system/contracts/network-management.mjs";
import {
  networkManagementActionMessage,
  networkManagementFailureMessage,
  runNetworkManagementAction,
} from "../system/services/network/management-runtime.mjs";

function port(calls) {
  return {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() { calls.push("status"); return Promise.resolve({}); },
    scan() { calls.push("scan"); return Promise.resolve({ action: "scan" }); },
    connect(value) { calls.push(["connect", value]); return Promise.resolve({ action: "connect" }); },
    disconnect() { calls.push("disconnect"); return Promise.resolve({ action: "disconnect" }); },
    forget() { calls.push("forget"); return Promise.resolve({ action: "forget" }); },
    reconnect() { calls.push("reconnect"); return Promise.resolve({ action: "reconnect" }); },
  };
}

test("shared network management runtime dispatches only explicit actions", async () => {
  const calls = [];
  const management = port(calls);
  await runNetworkManagementAction(management, "scan");
  await runNetworkManagementAction(management, "connect", { ssid: "Casa", password: "12345678" });
  await runNetworkManagementAction(management, "disconnect");
  await runNetworkManagementAction(management, "forget");
  await runNetworkManagementAction(management, "reconnect");
  assert.deepEqual(calls, [
    "scan",
    ["connect", { ssid: "Casa", password: "12345678" }],
    "disconnect",
    "forget",
    "reconnect",
  ]);
  await assert.rejects(
    runNetworkManagementAction(management, "unknown"),
    /Ação de Wi-Fi inválida/,
  );
});

test("shared network management runtime owns PT-BR action messages", () => {
  assert.equal(networkManagementActionMessage("scan", 0), "Procurando redes Wi-Fi…");
  assert.equal(networkManagementActionMessage("scan", 1), "Redes Wi-Fi atualizadas.");
  assert.equal(networkManagementActionMessage("connect", 1), "Wi-Fi conectado.");
  assert.equal(networkManagementActionMessage("forget", 1), "Rede Wi-Fi esquecida.");
  assert.throws(() => networkManagementActionMessage("unknown", 0));
});

test("shared network management runtime maps bounded failures without secrets", () => {
  const rejected = Object.assign(new Error("server detail that must not surface"), { status: 409 });
  assert.equal(
    networkManagementFailureMessage("connect", rejected),
    "Não foi possível conectar. Confira a senha e se a rede ainda está disponível.",
  );
  const message = networkManagementFailureMessage("disconnect", new Error("secret text"));
  assert.equal(
    message,
    "A ação de Wi-Fi não pôde ser concluída. A rede anterior foi preservada quando aplicável.",
  );
  assert.equal(message.includes("secret text"), false);
});
