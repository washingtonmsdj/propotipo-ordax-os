import {
  assertPowerStatusPort,
  validatePowerStatusSnapshot,
} from "../../contracts/power-status.mjs";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

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
  const content = root.querySelector("[data-quick-battery-content]");
  if (!panel || !content) {
    throw new Error("Battery quick panel requires shared shell slots");
  }

  const documentObject = root.ownerDocument;
  let destroyed = false;
  let pending = false;

  const render = (snapshot) => {
    content.replaceChildren();
    const value = validatePowerStatusSnapshot(snapshot);
    if (value.battery === null) {
      content.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          "Nenhuma bateria válida foi detectada neste dispositivo.",
        ),
      );
      return;
    }

    const hero = node(documentObject, "div", "ordax-quick-battery-hero");
    hero.append(
      node(documentObject, "strong", "ordax-quick-battery-percent", `${value.battery.percent}%`),
      node(documentObject, "span", "", stateLabel(value.battery.state)),
    );
    content.append(hero);

    const rows = node(documentObject, "div", "ordax-quick-battery-rows");
    const addRow = (label, valueText) => {
      const row = node(documentObject, "div", "ordax-quick-battery-row");
      row.append(
        node(documentObject, "span", "", label),
        node(documentObject, "strong", "", valueText),
      );
      rows.append(row);
    };
    addRow("Bateria", stateLabel(value.battery.state));
    addRow(
      "Energia externa",
      value.externalPower === true
        ? "Conectada"
        : value.externalPower === false
          ? "Desconectada"
          : "Desconhecida",
    );
    content.append(rows);
  };

  const refresh = async () => {
    if (destroyed || pending) return;
    pending = true;
    try {
      render(await port.read());
    } catch {
      content.replaceChildren(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          "Não foi possível atualizar o estado da bateria.",
        ),
      );
    } finally {
      pending = false;
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
