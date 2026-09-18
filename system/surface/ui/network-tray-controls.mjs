import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";

const POLL_INTERVAL_MS = 5000;

function signalLevel(signalDbm) {
  if (!Number.isInteger(signalDbm)) return 0;
  if (signalDbm >= -50) return 4;
  if (signalDbm >= -60) return 3;
  if (signalDbm >= -70) return 2;
  return 1;
}

function choosePrimaryInterface(snapshot) {
  const connected = snapshot.interfaces.filter((entry) => entry.state === "connected");
  const wifi = connected
    .filter((entry) => entry.kind === "wifi")
    .sort((left, right) => (right.signalDbm ?? -999) - (left.signalDbm ?? -999))[0];
  if (wifi) return wifi;
  const ethernet = connected.find((entry) => entry.kind === "ethernet");
  if (ethernet) return ethernet;
  if (connected[0]) return connected[0];
  return (
    snapshot.interfaces.find((entry) => entry.kind === "wifi")
    ?? snapshot.interfaces.find((entry) => entry.kind === "ethernet")
    ?? snapshot.interfaces[0]
    ?? null
  );
}

function stateCopy(entry) {
  if (!entry) {
    return {
      kind: "unknown",
      state: "unknown",
      signalLevel: 0,
      label: "Rede indisponível",
      title: "Nenhuma interface de rede observada",
    };
  }
  if (entry.state !== "connected") {
    const kindLabel =
      entry.kind === "wifi" ? "Wi-Fi" : entry.kind === "ethernet" ? "Cabo" : "Rede";
    const stateLabel = entry.state === "unknown" ? "estado desconhecido" : "desconectado";
    return {
      kind: entry.kind,
      state: entry.state,
      signalLevel: 0,
      label: entry.state === "unknown" ? kindLabel : `${kindLabel} desconectado`,
      title: `${kindLabel}: ${stateLabel}`,
    };
  }
  if (entry.kind === "wifi") {
    const level = signalLevel(entry.signalDbm);
    const quality = ["", "fraco", "regular", "bom", "forte"][level] ?? "";
    return {
      kind: "wifi",
      state: "connected",
      signalLevel: level,
      label: "Wi-Fi",
      title: `Wi-Fi conectado${quality ? ` · sinal ${quality}` : ""}`,
    };
  }
  if (entry.kind === "ethernet") {
    return {
      kind: "ethernet",
      state: "connected",
      signalLevel: 0,
      label: "Cabo",
      title: "Rede por cabo conectada",
    };
  }
  return {
    kind: "other",
    state: "connected",
    signalLevel: 0,
    label: "Rede",
    title: "Rede conectada",
  };
}

export function summarizeNetworkStatus(value) {
  const snapshot = validateNetworkStatusSnapshot(value);
  return Object.freeze(stateCopy(choosePrimaryInterface(snapshot)));
}

export function mountNetworkTrayControls(
  root,
  networkStatus,
  { pollIntervalMs = POLL_INTERVAL_MS } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network tray controls require a Surface root Element");
  }
  const port = assertNetworkStatusPort(networkStatus);
  const tray = root.querySelector("[data-connectivity-tray]");
  const label = root.querySelector("[data-connectivity-label]");
  const icon = root.querySelector("[data-connectivity-icon]");
  if (!tray || !label || !icon) {
    throw new Error("Network tray controls require the shared system tray");
  }

  let destroyed = false;
  let polling = false;

  const render = (snapshot) => {
    const next = summarizeNetworkStatus(snapshot);
    tray.dataset.networkKind = next.kind;
    tray.dataset.networkState = next.state;
    tray.title = next.title;
    label.textContent = next.label;
    icon.dataset.state = next.state === "connected" ? "online" : "offline";
    icon.dataset.networkKind = next.kind;
    icon.dataset.signalLevel = String(next.signalLevel);
    tray.dataset.networkDetailOwner = "true";
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const snapshot = validateNetworkStatusSnapshot(await port.read());
      if (destroyed) return;
      render(snapshot);
    } catch {
      if (destroyed) return;
      tray.dataset.networkKind = "unknown";
      tray.dataset.networkState = "unknown";
      tray.title = "Estado detalhado da rede indisponível";
      label.textContent = "Rede";
      icon.dataset.state = "unknown";
      icon.dataset.networkKind = "unknown";
      icon.dataset.signalLevel = "0";
      tray.dataset.networkDetailOwner = "true";
    } finally {
      if (!destroyed) polling = false;
    }
  };

  void refresh();
  const timer = setInterval(() => void refresh(), pollIntervalMs);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      delete tray.dataset.networkDetailOwner;
    },
  });
}
