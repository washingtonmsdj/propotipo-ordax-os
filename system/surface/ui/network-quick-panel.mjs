import {
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
} from "../../contracts/network-management.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import { summarizeNetworkStatus } from "./network-tray-controls.mjs";

const MAX_QUICK_NETWORKS = 8;

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function signalLabel(signalDbm) {
  if (signalDbm >= -50) return "Sinal forte";
  if (signalDbm >= -60) return "Sinal bom";
  if (signalDbm >= -70) return "Sinal regular";
  return "Sinal fraco";
}

export function mountNetworkQuickPanel(
  root,
  networkStatus,
  networkManagement = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network quick panel requires a Surface root Element");
  }
  const statusPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const managementPort =
    networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const panel = root.querySelector('[data-quick-panel="network"]');
  const content = root.querySelector("[data-quick-network-content]");
  if (!panel || !content) {
    throw new Error("Network quick panel requires shared shell slots");
  }

  const documentObject = root.ownerDocument;
  let statusSnapshot = null;
  let managementSnapshot = null;
  let selectedSsid = null;
  let pending = false;
  let message = "";
  let destroyed = false;

  const render = () => {
    content.replaceChildren();

    const summary = node(documentObject, "div", "ordax-quick-network-summary");
    if (statusSnapshot) {
      const state = summarizeNetworkStatus(statusSnapshot);
      summary.append(
        node(documentObject, "strong", "", state.label),
        node(documentObject, "span", "", state.title),
      );
    } else {
      summary.append(
        node(documentObject, "strong", "", "Rede"),
        node(
          documentObject,
          "span",
          "",
          statusPort ? "Lendo estado da conexão…" : "Detalhes locais de rede indisponíveis neste ambiente.",
        ),
      );
    }
    content.append(summary);

    if (!managementPort) {
      content.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          "O gerenciamento rápido de Wi-Fi não está disponível neste ambiente.",
        ),
      );
      return;
    }

    const actions = node(documentObject, "div", "ordax-quick-actions");
    const addAction = (action, label, primary = false) => {
      const button = node(
        documentObject,
        "button",
        primary ? "ordax-quick-action ordax-quick-action-primary" : "ordax-quick-action",
        label,
      );
      button.type = "button";
      button.dataset.quickNetworkAction = action;
      button.disabled = pending;
      actions.append(button);
    };
    addAction("scan", pending ? "Aguarde…" : "Procurar redes", true);
    if (managementSnapshot?.currentSsid) addAction("disconnect", "Desconectar");
    if (managementSnapshot?.savedSsid && !managementSnapshot.currentSsid) {
      addAction("reconnect", "Reconectar");
    }
    content.append(actions);

    if (message) {
      const status = node(documentObject, "p", "ordax-quick-message", message);
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      content.append(status);
    }

    if (managementSnapshot === null) {
      content.append(node(documentObject, "p", "ordax-quick-empty", "Lendo Wi-Fi…"));
      return;
    }

    if (managementSnapshot.currentSsid) {
      const current = node(documentObject, "div", "ordax-quick-current");
      current.append(
        node(documentObject, "span", "ordax-quick-kicker", "Conectado"),
        node(documentObject, "strong", "", managementSnapshot.currentSsid),
      );
      content.append(current);
    }

    const list = node(documentObject, "div", "ordax-quick-network-list");
    const networks = [...managementSnapshot.networks]
      .sort((left, right) => right.signalDbm - left.signalDbm)
      .slice(0, MAX_QUICK_NETWORKS);
    if (networks.length === 0) {
      list.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          "Use “Procurar redes” para encontrar redes Wi-Fi compatíveis.",
        ),
      );
    } else {
      for (const entry of networks) {
        const button = node(documentObject, "button", "ordax-quick-network");
        button.type = "button";
        button.dataset.quickWifiSsid = entry.ssid;
        button.dataset.selected = String(selectedSsid === entry.ssid);
        button.dataset.connected = String(entry.connected);
        button.disabled = pending || entry.connected;
        button.setAttribute("aria-pressed", String(selectedSsid === entry.ssid));
        const copy = node(documentObject, "span", "ordax-quick-network-copy");
        copy.append(
          node(documentObject, "strong", "", entry.ssid),
          node(
            documentObject,
            "small",
            "",
            `${entry.connected ? "Conectada" : entry.saved ? "Salva" : "Disponível"} · ${signalLabel(entry.signalDbm)}`,
          ),
        );
        button.append(
          node(documentObject, "span", "ordax-quick-network-dot"),
          copy,
        );
        list.append(button);
      }
    }
    content.append(list);

    const selected = managementSnapshot.networks.find(
      (entry) => entry.ssid === selectedSsid,
    );
    if (selected && !selected.connected) {
      const form = node(documentObject, "div", "ordax-quick-network-form");
      const label = node(documentObject, "label", "ordax-quick-network-password");
      label.append(node(documentObject, "span", "", `Senha de ${selected.ssid}`));
      const input = documentObject.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.dataset.quickWifiPassword = "";
      input.dataset.quickWifiPasswordFor = selected.ssid;
      input.disabled = pending;
      label.append(input);
      const connect = node(documentObject, "button", "ordax-quick-action ordax-quick-action-primary", "Conectar");
      connect.type = "button";
      connect.dataset.quickNetworkAction = "connect";
      connect.dataset.quickWifiSsid = selected.ssid;
      connect.disabled = pending;
      form.append(label, connect);
      content.append(form);
      queueMicrotask(() => input.focus());
    }

    const settings = node(documentObject, "button", "ordax-quick-settings-link", "Abrir Ajustes de rede");
    settings.type = "button";
    settings.dataset.launchApp = "settings";
    settings.dataset.quickPanelClose = "";
    content.append(settings);
  };

  const refreshStatus = async () => {
    if (!statusPort || destroyed) return;
    try {
      statusSnapshot = validateNetworkStatusSnapshot(await statusPort.read());
    } catch {
      statusSnapshot = null;
    }
  };

  const refreshManagement = async () => {
    if (!managementPort || destroyed) return;
    try {
      managementSnapshot = validateNetworkManagementSnapshot(await managementPort.status());
    } catch {
      managementSnapshot = null;
      message = "O gerenciamento de Wi-Fi está temporariamente indisponível.";
    }
  };

  const refresh = async () => {
    await Promise.all([refreshStatus(), refreshManagement()]);
    if (!destroyed) render();
  };

  const runAction = async (action, credentials = null) => {
    if (!managementPort || pending || destroyed) return;
    pending = true;
    message = {
      scan: "Procurando redes Wi-Fi…",
      connect: "Conectando ao Wi-Fi…",
      disconnect: "Desconectando do Wi-Fi…",
      reconnect: "Reconectando ao Wi-Fi salvo…",
    }[action] ?? "";
    render();

    try {
      const next =
        action === "scan"
          ? await managementPort.scan()
          : action === "connect"
            ? await managementPort.connect(credentials)
            : action === "disconnect"
              ? await managementPort.disconnect()
              : await managementPort.reconnect();
      managementSnapshot = validateNetworkManagementSnapshot(next);
      selectedSsid = null;
      message = {
        scan: "Redes Wi-Fi atualizadas.",
        connect: "Wi-Fi conectado.",
        disconnect: "Wi-Fi desconectado.",
        reconnect: "Wi-Fi reconectado.",
      }[action] ?? "";
      await refreshStatus();
    } catch (error) {
      if (action === "connect" && error?.status === 409) {
        message = "Não foi possível conectar. Confira a senha e tente novamente.";
      } else if (action === "reconnect" && error?.status === 409) {
        message = "A rede salva não pôde ser reconectada.";
      } else if (error instanceof TypeError) {
        message = "A senha deve ter entre 8 e 63 caracteres válidos.";
      } else {
        message = "A ação de Wi-Fi não pôde ser concluída.";
      }
    } finally {
      pending = false;
      if (!destroyed) render();
    }
  };

  const onOpen = () => {
    message = "";
    selectedSsid = null;
    void refresh();
  };

  const onClick = (event) => {
    const network = event.target.closest("[data-quick-wifi-ssid]");
    if (network && panel.contains(network)) {
      selectedSsid = network.dataset.quickWifiSsid ?? null;
      message = "";
      render();
      return;
    }

    const action = event.target.closest("[data-quick-network-action]");
    if (!action || !panel.contains(action)) return;
    const kind = action.dataset.quickNetworkAction;
    if (kind === "connect") {
      const ssid = action.dataset.quickWifiSsid;
      const input = panel.querySelector("[data-quick-wifi-password]");
      if (!(input instanceof HTMLInputElement) || input.dataset.quickWifiPasswordFor !== ssid) {
        return;
      }
      const password = input.value;
      input.value = "";
      if (!password) {
        message = "Digite a senha da rede Wi-Fi.";
        render();
        return;
      }
      void runAction("connect", { ssid, password });
      return;
    }
    void runAction(kind);
  };

  const onKeyDown = (event) => {
    const input = event.target.closest("[data-quick-wifi-password]");
    if (!input || !panel.contains(input)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      panel.querySelector('[data-quick-network-action="connect"]')?.click();
    }
  };

  panel.addEventListener("ordax:quick-panel-open", onOpen);
  panel.addEventListener("click", onClick);
  panel.addEventListener("keydown", onKeyDown);

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
      panel.removeEventListener("click", onClick);
      panel.removeEventListener("keydown", onKeyDown);
    },
  });
}
