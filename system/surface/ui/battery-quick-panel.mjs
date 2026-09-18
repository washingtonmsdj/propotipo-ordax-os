import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";

function stateLabel(state) {
  return {
    charging: "Carregando",
    discharging: "Usando bateria",
    full: "Carga completa",
    "not-charging": "Conectada à energia",
    unknown: "Estado desconhecido",
  }[state] ?? "Estado desconhecido";
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

  const render = (snapshot) => {
    const value = validatePowerStatusSnapshot(snapshot);
    if (value.battery === null) {
      percent.textContent = "--%";
      state.textContent = "Nenhuma bateria válida foi detectada.";
      power.textContent =
        value.externalPower === true
          ? "Conectada"
          : value.externalPower === false
            ? "Desconectada"
            : "Desconhecida";
      return;
    }

    percent.textContent = `${value.battery.percent}%`;
    state.textContent = stateLabel(value.battery.state);
    power.textContent =
      value.externalPower === true
        ? "Conectada"
        : value.externalPower === false
          ? "Desconectada"
          : "Desconhecida";
  };

  const refresh = async () => {
    if (destroyed || pending) return;
    pending = true;
    try {
      const snapshot = await port.read();
      if (destroyed) return;
      render(snapshot);
    } catch {
      if (destroyed) return;
      state.textContent = "Não foi possível atualizar o estado da bateria.";
      power.textContent = "Desconhecida";
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
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
    },
  });
}
