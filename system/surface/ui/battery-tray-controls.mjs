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

function batteryTitle(battery, externalPower) {
  const stateCopy = {
    charging: "carregando",
    discharging: "em uso",
    full: "carregada",
    "not-charging": "conectada à energia",
    unknown: "estado desconhecido",
  }[battery.state] ?? "estado desconhecido";
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

  const render = (snapshot) => {
    const value = validatePowerStatusSnapshot(snapshot);
    if (value.battery === null) {
      item.hidden = true;
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
  };

  const refresh = async () => {
    if (destroyed || polling) return;
    polling = true;
    try {
      render(await port.read());
    } catch {
      item.hidden = true;
    } finally {
      polling = false;
    }
  };

  void refresh();
  const timer = setInterval(() => void refresh(), pollIntervalMs);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      clearInterval(timer);
    },
  });
}
