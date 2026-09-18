import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";

const POLL_INTERVAL_MS = 30000;
const POWER_TIME_ZONE = "America/Bahia";

export function formatPowerReceivedAt(value) {
  if (!Number.isFinite(value)) return "horário desconhecido";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: POWER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function batteryLevel(percent) {
  if (percent <= 10) return 0;
  if (percent <= 25) return 1;
  if (percent <= 50) return 2;
  if (percent <= 75) return 3;
  return 4;
}

function batteryStateLabel(state) {
  return {
    charging: "Carregando",
    discharging: "Em uso",
    full: "Carga completa",
    "not-charging": "Conectada à energia",
    unknown: "Estado desconhecido",
  }[state] ?? "Estado desconhecido";
}

function batteryTitle(battery, externalPower) {
  const stateCopy = batteryStateLabel(battery.state).toLocaleLowerCase("pt-BR");
  const powerCopy =
    externalPower === true
      ? " · energia externa conectada"
      : externalPower === false
        ? " · usando bateria"
        : "";
  return `Bateria ${battery.percent}% · ${stateCopy}${powerCopy}`;
}

export function mountBatteryTrayControls(
  root,
  powerStatus,
  { pollIntervalMs = POLL_INTERVAL_MS } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Battery tray controls require a Surface root Element");
  }
  const port = assertPowerStatusPort(powerStatus);
  const item = root.querySelector("[data-battery-tray]");
  const icon = root.querySelector("[data-battery-icon]");
  const label = root.querySelector("[data-battery-label]");
  if (!item || !icon || !label) {
    throw new Error("Battery tray controls require the shared system tray");
  }

  let destroyed = false;
  let polling = false;
  let lastSnapshot = null;
  let lastSuccessAt = null;

  const render = (snapshot, { stale = false } = {}) => {
    const value = validatePowerStatusSnapshot(snapshot);
    item.hidden = false;
    item.dataset.batteryObservation = stale ? "stale" : "current";
    item.dataset.externalPower =
      value.externalPower === null ? "unknown" : String(value.externalPower);

    if (value.battery === null) {
      item.dataset.batteryState = "not-detected";
      icon.dataset.batteryLevel = "unknown";
      icon.dataset.charging = "false";
      label.textContent = stale ? "-- · antigo" : "--";
      item.title = stale
        ? `Dados antigos · bateria não detectada · última leitura recebida pela Surface às ${formatPowerReceivedAt(lastSuccessAt)}`
        : "Bateria não detectada";
      return;
    }

    item.dataset.batteryState = value.battery.state;
    icon.dataset.batteryLevel = stale
      ? "unknown"
      : String(batteryLevel(value.battery.percent));
    icon.dataset.charging = stale ? "false" : String(value.battery.state === "charging");
    label.textContent = stale ? `${value.battery.percent}% · antigo` : `${value.battery.percent}%`;
    const title = batteryTitle(value.battery, value.externalPower);
    item.title = stale
      ? `Dados antigos · ${title} · última leitura recebida pela Surface às ${formatPowerReceivedAt(lastSuccessAt)}`
      : title;
  };

  const renderUnavailable = () => {
    item.hidden = false;
    item.dataset.batteryState = "unavailable";
    item.dataset.batteryObservation = "unavailable";
    item.dataset.externalPower = "unknown";
    icon.dataset.batteryLevel = "unknown";
    icon.dataset.charging = "false";
    label.textContent = "--";
    item.title = "Estado da bateria indisponível";
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const snapshot = validatePowerStatusSnapshot(await port.read());
      if (destroyed) return;
      lastSnapshot = snapshot;
      lastSuccessAt = Date.now();
      render(snapshot);
    } catch {
      if (destroyed) return;
      if (lastSnapshot) {
        render(lastSnapshot, { stale: true });
      } else {
        renderUnavailable();
      }
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
      lastSnapshot = null;
      lastSuccessAt = null;
      delete item.dataset.batteryObservation;
    },
  });
}
