import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";

const POLL_INTERVAL_MS = 30000;

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

function externalPowerLabel(externalPower) {
  if (externalPower === true) return "Energia externa conectada";
  if (externalPower === false) return "Usando bateria";
  return "Estado da fonte desconhecido";
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
  const panel = root.querySelector('[data-quick-panel="battery"]');
  const quickPercent = root.querySelector("[data-quick-battery-percent]");
  const quickState = root.querySelector("[data-quick-battery-state]");
  const quickPower = root.querySelector("[data-quick-battery-power]");
  if (!item || !icon || !label || !panel || !quickPercent || !quickState || !quickPower) {
    throw new Error("Battery tray controls require the shared system tray and quick panel");
  }

  let destroyed = false;
  let polling = false;

  const render = (snapshot) => {
    const value = validatePowerStatusSnapshot(snapshot);
    if (value.battery === null) {
      item.hidden = false;
      item.dataset.batteryState = "not-detected";
      item.dataset.externalPower =
        value.externalPower === null ? "unknown" : String(value.externalPower);
      icon.dataset.batteryLevel = "unknown";
      icon.dataset.charging = "false";
      label.textContent = "--";
      item.title = "Bateria não detectada";
      quickPercent.textContent = "--";
      quickState.textContent = "Bateria não detectada.";
      quickPower.textContent = externalPowerLabel(value.externalPower);
      return;
    }
    item.hidden = false;
    item.dataset.batteryState = value.battery.state;
    item.dataset.externalPower =
      value.externalPower === null ? "unknown" : String(value.externalPower);
    icon.dataset.batteryLevel = String(batteryLevel(value.battery.percent));
    icon.dataset.charging = String(value.battery.state === "charging");
    label.textContent = `${value.battery.percent}%`;
    item.title = batteryTitle(value.battery, value.externalPower);
    quickPercent.textContent = `${value.battery.percent}%`;
    quickState.textContent = batteryStateLabel(value.battery.state);
    quickPower.textContent = externalPowerLabel(value.externalPower);
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const snapshot = await port.read();
      if (destroyed) return;
      render(snapshot);
    } catch {
      if (destroyed) return;
      item.hidden = false;
      item.dataset.batteryState = "unavailable";
      icon.dataset.batteryLevel = "unknown";
      icon.dataset.charging = "false";
      label.textContent = "--";
      item.title = "Estado da bateria indisponível";
      quickPercent.textContent = "--";
      quickState.textContent = "Estado da bateria indisponível.";
      quickPower.textContent = "Não foi possível consultar a fonte de energia.";
    } finally {
      if (!destroyed) polling = false;
    }
  };

  const onQuickPanelOpen = () => void refresh();
  panel.addEventListener("ordax:quick-panel-open", onQuickPanelOpen);

  void refresh();
  const timer = setInterval(() => void refresh(), pollIntervalMs);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      panel.removeEventListener("ordax:quick-panel-open", onQuickPanelOpen);
    },
  });
}
