import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";
import { formatPowerReceivedAt } from "./battery-tray-controls.mjs";

function stateLabel(state) {
  return {
    charging: "Carregando",
    discharging: "Usando bateria",
    full: "Carga completa",
    "not-charging": "Conectada à energia",
    unknown: "Estado desconhecido",
  }[state] ?? "Estado desconhecido";
}

function powerLabel(externalPower) {
  return externalPower === true
    ? "Conectada"
    : externalPower === false
      ? "Desconectada"
      : "Desconhecida";
}

export function mountBatteryQuickPanel(root, powerStatus) {
  if (!(root instanceof Element)) {
    throw new TypeError("Battery quick panel requires a Surface root Element");
  }
  const port = assertPowerStatusPort(powerStatus);
  const panel = root.querySelector('[data-quick-panel="battery"]');
  const percent = root.querySelector("[data-quick-battery-percent]");
  const state = root.querySelector("[data-quick-battery-state]");
  const power = root.querySelector("[data-quick-battery-power]");
  if (!panel || !percent || !state || !power) {
    throw new Error("Battery quick panel requires shared shell slots");
  }

  let destroyed = false;
  let pending = false;
  let lastSnapshot = null;
  let lastSuccessAt = null;

  const render = (snapshot, { stale = false } = {}) => {
    const value = validatePowerStatusSnapshot(snapshot);
    panel.dataset.powerObservation = stale ? "stale" : "current";

    if (value.battery === null) {
      percent.textContent = "--%";
      state.textContent = stale
        ? `Nenhuma bateria válida foi detectada · dados antigos · última leitura recebida pela Surface às ${formatPowerReceivedAt(lastSuccessAt)}.`
        : "Nenhuma bateria válida foi detectada.";
      power.textContent = powerLabel(value.externalPower);
      return;
    }

    percent.textContent = `${value.battery.percent}%`;
    state.textContent = stale
      ? `${stateLabel(value.battery.state)} · dados antigos · última leitura recebida pela Surface às ${formatPowerReceivedAt(lastSuccessAt)}.`
      : stateLabel(value.battery.state);
    power.textContent = powerLabel(value.externalPower);
  };

  const renderUnavailable = () => {
    panel.dataset.powerObservation = "unavailable";
    percent.textContent = "--%";
    state.textContent = "Estado da bateria indisponível.";
    power.textContent = "Não foi possível consultar a fonte de energia.";
  };

  const refresh = async () => {
    if (destroyed || pending) return;
    pending = true;
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
      if (!destroyed) pending = false;
    }
  };

  const onOpen = () => {
    void refresh();
  };

  panel.addEventListener("ordax:quick-panel-open", onOpen);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      lastSnapshot = null;
      lastSuccessAt = null;
      delete panel.dataset.powerObservation;
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
    },
  });
}
