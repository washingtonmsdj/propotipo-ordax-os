import {
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
} from "../../contracts/network-management.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import {
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import {
  networkManagementActionMessage,
  networkManagementFailureMessage,
  runNetworkManagementAction,
} from "../../services/network/management-runtime.mjs";
import { listPreferenceDefinitions } from "../../services/preferences/catalog.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const SETTINGS_WINDOW_SELECTOR = '[data-window-id="settings"]';
const SETTINGS_EXTENSION_SELECTOR = '[data-app-extension="settings-overview"]';

const CAPABILITY_LABELS = Object.freeze({
  "network.https": "Rede HTTPS",
  "network.status": "Estado local de rede",
  "network.management": "Gerenciamento de Wi-Fi",
  "filesystem.user-space": "Arquivos persistentes",
  "system.boot-control": "Energia do dispositivo",
  "system.metrics": "Métricas locais",
  "power.status": "Estado da bateria",
  "account.identity": "Identidade autenticada",
  "sync.safe-state": "Sincronização segura",
});

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function optionDescription(preferenceId, value) {
  if (preferenceId === "appearance.theme") {
    return value === "dark"
      ? "Contraste escuro para ambientes de pouca luz."
      : "Superfície clara e neutra como padrão do OrdaX.";
  }
  return String(value);
}

export function mountSettingsOverviewControls(
  root,
  host,
  preferenceRuntime,
  surfaceLifecycle = null,
  networkStatus = null,
  networkManagement = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Settings overview controls require a Surface root Element");
  }
  const hostPort = assertSurfaceHost(host);
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const networkPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const networkManagementPort =
    networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let preferenceSnapshot = preferences.getSnapshot();
  let networkSnapshot = null;
  let networkReadFailed = false;
  let networkManagementSnapshot = null;
  let networkManagementReadFailed = false;
  let networkManagementPending = false;
  let networkManagementMessage = "";
  let selectedNetworkSsid = null;
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${SETTINGS_WINDOW_SELECTOR} ${SETTINGS_EXTENSION_SELECTOR}`);

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-settings-header");
    header.append(
      node(documentObject, "span", "ordax-settings-eyebrow", "OrdaX"),
      node(documentObject, "h3", "ordax-settings-title", "Ajustes"),
      node(
        documentObject,
        "p",
        "ordax-settings-subtitle",
        "Preferências do produto compartilhado. O host apenas persiste ou sincroniza o estado autorizado.",
      ),
    );
    view.append(header);
  };

  const renderPreferences = (view) => {
    for (const definition of listPreferenceDefinitions()) {
      const section = node(documentObject, "section", "ordax-settings-section");
      section.append(
        node(documentObject, "span", "ordax-settings-section-kicker", definition.label ?? "Preferência"),
        node(documentObject, "h4", "ordax-settings-section-title", definition.title ?? definition.id),
        node(documentObject, "p", "ordax-settings-section-copy", definition.description ?? definition.id),
      );

      if (Array.isArray(definition.options) && definition.options.length > 0) {
        const options = node(documentObject, "div", "ordax-settings-options");
        for (const option of definition.options) {
          const selected = preferenceSnapshot[definition.id] === option.value;
          const button = node(documentObject, "button", "ordax-settings-option");
          button.type = "button";
          button.dataset.settingsPreferenceId = definition.id;
          button.dataset.settingsPreferenceValue = option.value;
          button.dataset.selected = String(selected);
          button.setAttribute("aria-pressed", String(selected));

          const preview = node(documentObject, "span", "ordax-settings-theme-preview");
          preview.dataset.themePreview = option.value;
          preview.setAttribute("aria-hidden", "true");
          const previewRail = node(documentObject, "span", "ordax-settings-theme-rail");
          const previewBody = node(documentObject, "span", "ordax-settings-theme-body");
          preview.append(previewRail, previewBody);

          const copy = node(documentObject, "span", "ordax-settings-option-copy");
          copy.append(
            node(documentObject, "strong", "", option.label),
            node(documentObject, "small", "", optionDescription(definition.id, option.value)),
          );
          const marker = node(documentObject, "span", "ordax-settings-option-marker", selected ? "Ativo" : "");
          button.append(preview, copy, marker);
          options.append(button);
        }
        section.append(options);
      }
      view.append(section);
    }
  };

  const renderNetworkManagement = (section) => {
    if (!networkManagementPort) return;

    const panel = node(documentObject, "div", "ordax-settings-wifi");
    panel.dataset.settingsWifi = "";

    const heading = node(documentObject, "div", "ordax-settings-wifi-heading");
    const headingCopy = node(documentObject, "div", "ordax-settings-wifi-heading-copy");
    headingCopy.append(
      node(documentObject, "strong", "", "Wi-Fi"),
      node(
        documentObject,
        "span",
        "",
        networkManagementSnapshot?.currentSsid
          ? `Conectado a ${networkManagementSnapshot.currentSsid}`
          : networkManagementSnapshot?.savedSsid
            ? `Rede salva: ${networkManagementSnapshot.savedSsid}`
            : "Nenhuma rede Wi-Fi conectada",
      ),
    );

    const actions = node(documentObject, "div", "ordax-settings-wifi-actions");
    const addAction = (action, label) => {
      const button = node(documentObject, "button", "ordax-settings-network-action", label);
      button.type = "button";
      button.dataset.settingsNetworkAction = action;
      button.disabled = networkManagementPending;
      actions.append(button);
    };
    addAction("scan", networkManagementPending ? "Aguarde…" : "Procurar redes");
    if (networkManagementSnapshot?.currentSsid) addAction("disconnect", "Desconectar");
    if (networkManagementSnapshot?.savedSsid) {
      if (!networkManagementSnapshot.currentSsid) addAction("reconnect", "Reconectar");
      addAction("forget", "Esquecer");
    }
    heading.append(headingCopy, actions);
    panel.append(heading);

    const message = node(
      documentObject,
      "p",
      "ordax-settings-network-message",
      networkManagementMessage,
    );
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    if (networkManagementMessage) panel.append(message);

    if (networkManagementReadFailed) {
      panel.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          "O gerenciamento de Wi-Fi está temporariamente indisponível. A rede atual continua preservada.",
        ),
      );
      section.append(panel);
      return;
    }

    if (networkManagementSnapshot === null) {
      panel.append(node(documentObject, "p", "ordax-settings-empty", "Lendo estado do Wi-Fi…"));
      section.append(panel);
      return;
    }

    const networks = node(documentObject, "div", "ordax-settings-wifi-list");
    if (networkManagementSnapshot.networks.length === 0) {
      networks.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          "Use “Procurar redes” para listar redes Wi-Fi compatíveis próximas.",
        ),
      );
    } else {
      for (const entry of networkManagementSnapshot.networks) {
        const button = node(documentObject, "button", "ordax-settings-wifi-network");
        button.type = "button";
        button.dataset.settingsWifiSsid = entry.ssid;
        button.dataset.selected = String(selectedNetworkSsid === entry.ssid);
        button.dataset.connected = String(entry.connected);
        button.disabled = networkManagementPending;
        button.setAttribute("aria-pressed", String(selectedNetworkSsid === entry.ssid));

        const copy = node(documentObject, "span", "ordax-settings-wifi-network-copy");
        const state = entry.connected
          ? "Conectada"
          : entry.saved
            ? "Salva"
            : "Disponível";
        copy.append(
          node(documentObject, "strong", "", entry.ssid),
          node(documentObject, "small", "", `${state} · sinal ${entry.signalDbm} dBm · WPA/WPA2`),
        );
        button.append(
          node(documentObject, "span", "ordax-settings-network-dot"),
          copy,
        );
        networks.append(button);
      }
    }
    panel.append(networks);

    const selected = networkManagementSnapshot.networks.find(
      (entry) => entry.ssid === selectedNetworkSsid,
    );
    if (selected && !selected.connected && !selected.saved) {
      const form = node(documentObject, "div", "ordax-settings-wifi-connect");
      const label = node(
        documentObject,
        "label",
        "ordax-settings-wifi-password-label",
        `Senha de “${selected.ssid}”`,
      );
      const input = node(documentObject, "input", "ordax-settings-wifi-password");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.disabled = networkManagementPending;
      input.dataset.settingsWifiPassword = "";
      input.dataset.settingsWifiPasswordFor = selected.ssid;
      input.setAttribute("aria-label", `Senha da rede ${selected.ssid}`);
      label.append(input);

      const connect = node(
        documentObject,
        "button",
        "ordax-settings-network-action ordax-settings-network-primary",
        networkManagementPending ? "Conectando…" : "Conectar",
      );
      connect.type = "button";
      connect.dataset.settingsNetworkAction = "connect";
      connect.dataset.settingsWifiSsid = selected.ssid;
      connect.disabled = networkManagementPending;
      form.append(label, connect);
      panel.append(form);
    }

    section.append(panel);
  };

  const renderNetwork = (view) => {
    if (!networkPort && !networkManagementPort) return;

    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsNetwork = "";
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", "Rede"),
      node(documentObject, "h4", "ordax-settings-section-title", "Rede e conexões"),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        networkManagementPort
          ? "Estado real do host e gerenciamento Wi-Fi pelo owner nativo. Senhas são usadas apenas no instante da conexão e não entram em preferências ou sincronização."
          : "Estado real observado no host nativo. O gerenciamento de Wi-Fi não está disponível neste ambiente.",
      ),
    );

    const service = node(documentObject, "div", "ordax-settings-network-service");
    service.dataset.state = hostSnapshot.connectivity;
    const serviceLabels = {
      online: "Conectividade do host disponível",
      offline: "Host sem conectividade",
      unknown: "Conectividade do host desconhecida",
    };
    service.append(
      node(documentObject, "span", "ordax-settings-network-dot"),
      node(documentObject, "strong", "", serviceLabels[hostSnapshot.connectivity] ?? serviceLabels.unknown),
    );
    section.append(service);

    if (networkPort) {
      if (networkReadFailed) {
        section.append(
          node(
            documentObject,
            "p",
            "ordax-settings-empty",
            "Não foi possível atualizar os detalhes das interfaces. O gerenciamento Wi-Fi continua disponível quando suportado.",
          ),
        );
      } else if (networkSnapshot === null) {
        section.append(node(documentObject, "p", "ordax-settings-empty", "Lendo interfaces de rede…"));
      } else {
        const interfaces = node(documentObject, "div", "ordax-settings-network-list");
        if (networkSnapshot.interfaces.length === 0) {
          interfaces.append(
            node(documentObject, "p", "ordax-settings-empty", "Nenhuma interface de rede utilizável foi observada."),
          );
        } else {
          const kindLabels = { wifi: "Wi-Fi", ethernet: "Cabo", other: "Outra interface" };
          const stateLabels = {
            connected: "Conectado",
            disconnected: "Desconectado",
            unknown: "Estado desconhecido",
          };
          for (const entry of networkSnapshot.interfaces) {
            const item = node(documentObject, "div", "ordax-settings-network-item");
            item.dataset.state = entry.state;
            const copy = node(documentObject, "span", "ordax-settings-network-copy");
            copy.append(
              node(documentObject, "strong", "", kindLabels[entry.kind] ?? kindLabels.other),
              node(
                documentObject,
                "small",
                "",
                `${entry.name} · ${stateLabels[entry.state] ?? stateLabels.unknown}${entry.signalDbm === null ? "" : ` · sinal ${entry.signalDbm} dBm`}`,
              ),
            );
            item.append(node(documentObject, "span", "ordax-settings-network-dot"), copy);
            interfaces.append(item);
          }
        }
        section.append(interfaces);
      }
    }
    renderNetworkManagement(section);
    view.append(section);
  };

  const renderHost = (view) => {
    const section = node(documentObject, "section", "ordax-settings-section");
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", "Host atual"),
      node(documentObject, "h4", "ordax-settings-section-title", "Capacidades disponíveis"),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        "A Surface habilita recursos pelo contrato anunciado, nunca pelo nome da plataforma.",
      ),
    );

    const list = node(documentObject, "div", "ordax-settings-capabilities");
    if (hostSnapshot.capabilityIds.length === 0) {
      list.append(node(documentObject, "p", "ordax-settings-empty", "Nenhuma capacidade adicional declarada."));
    } else {
      for (const capabilityId of hostSnapshot.capabilityIds) {
        const item = node(documentObject, "div", "ordax-settings-capability");
        item.append(
          node(documentObject, "span", "ordax-settings-capability-dot"),
          node(documentObject, "strong", "", CAPABILITY_LABELS[capabilityId] ?? capabilityId),
          node(documentObject, "small", "", capabilityId),
        );
        list.append(item);
      }
    }
    section.append(list);

    const continuity = node(documentObject, "div", "ordax-settings-continuity");
    const syncAvailable = hostSnapshot.capabilityIds.includes("sync.safe-state");
    continuity.dataset.state = syncAvailable ? "available" : "local";
    continuity.append(
      node(documentObject, "strong", "", syncAvailable ? "Preferências sincronizáveis" : "Preferências locais"),
      node(
        documentObject,
        "span",
        "",
        syncAvailable
          ? "Este host declarou sincronização segura para classes de estado autorizadas."
          : "As preferências permanecem neste host até existir uma capacidade de sync autorizada.",
      ),
    );
    section.append(continuity);
    view.append(section);
  };

  const paint = (slot) => {
    slot.replaceChildren();
    slot.dataset.ordaxSettingsOverviewView = "";
    const view = node(documentObject, "div", "ordax-settings-view");
    renderHeader(view);
    renderPreferences(view);
    renderNetwork(view);
    renderHost(view);
    slot.append(view);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    mountedSlot = slot;
    paint(slot);
  };

  const replaceView = () => renderView(true);

  const refreshNetwork = async () => {
    if (!networkPort || destroyed) return;
    let changed = false;
    try {
      const nextSnapshot = validateNetworkStatusSnapshot(await networkPort.read());
      changed =
        networkReadFailed ||
        JSON.stringify(nextSnapshot) !== JSON.stringify(networkSnapshot);
      networkSnapshot = nextSnapshot;
      networkReadFailed = false;
    } catch {
      changed = !networkReadFailed;
      networkReadFailed = true;
    }
    if (changed && !destroyed) replaceView();
  };

  const refreshNetworkManagement = async () => {
    if (!networkManagementPort || destroyed || networkManagementPending) return;
    let changed = false;
    try {
      const nextSnapshot = validateNetworkManagementSnapshot(
        await networkManagementPort.status(),
      );
      changed =
        networkManagementReadFailed
        || JSON.stringify(nextSnapshot) !== JSON.stringify(networkManagementSnapshot);
      networkManagementSnapshot = nextSnapshot;
      networkManagementReadFailed = false;
      if (
        selectedNetworkSsid !== null
        && !nextSnapshot.networks.some((entry) => entry.ssid === selectedNetworkSsid)
      ) {
        selectedNetworkSsid = null;
        changed = true;
      }
    } catch {
      changed = !networkManagementReadFailed;
      networkManagementReadFailed = true;
    }
    if (changed && !destroyed) replaceView();
  };

  const runNetworkAction = async (action, { ssid = null, password = null } = {}) => {
    if (!networkManagementPort || networkManagementPending || destroyed) return;
    networkManagementPending = true;
    networkManagementMessage = networkManagementActionMessage(action, 0);
    replaceView();

    try {
      networkManagementSnapshot = validateNetworkManagementSnapshot(
        await runNetworkManagementAction(
          networkManagementPort,
          action,
          action === "connect" ? { ssid, password } : null,
        ),
      );
      networkManagementReadFailed = false;
      networkManagementMessage = networkManagementActionMessage(action, 1);
      if (action === "connect" || action === "forget") selectedNetworkSsid = null;
      void refreshNetwork();
    } catch (error) {
      networkManagementMessage = networkManagementFailureMessage(action, error);
    } finally {
      networkManagementPending = false;
      if (!destroyed) replaceView();
    }
  };

  const onClick = (event) => {
    const preferenceButton = event.target.closest("[data-settings-preference-id]");
    if (preferenceButton && root.contains(preferenceButton)) {
      preferences.set(
        preferenceButton.dataset.settingsPreferenceId,
        preferenceButton.dataset.settingsPreferenceValue,
      );
      return;
    }

    const networkButton = event.target.closest("[data-settings-wifi-ssid]");
    if (
      networkButton
      && root.contains(networkButton)
      && !networkButton.matches("[data-settings-network-action]")
    ) {
      selectedNetworkSsid = networkButton.dataset.settingsWifiSsid ?? null;
      networkManagementMessage = "";
      replaceView();
      return;
    }

    const actionButton = event.target.closest("[data-settings-network-action]");
    if (!actionButton || !root.contains(actionButton)) return;
    const action = actionButton.dataset.settingsNetworkAction;

    if (action === "connect") {
      const ssid = actionButton.dataset.settingsWifiSsid;
      const input = root.querySelector("[data-settings-wifi-password]");
      if (
        !(input instanceof HTMLInputElement)
        || input.dataset.settingsWifiPasswordFor !== ssid
      ) return;
      let password = input.value;
      input.value = "";
      if (!password) {
        networkManagementMessage = "Digite a senha da rede Wi-Fi.";
        password = "";
        replaceView();
        return;
      }
      const operationPassword = password;
      password = "";
      void runNetworkAction("connect", { ssid, password: operationPassword });
      return;
    }

    void runNetworkAction(action);
  };

  const onKeyDown = (event) => {
    const input = event.target.closest("[data-settings-wifi-password]");
    if (!input || !root.contains(input)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const connect = root.querySelector(
        '[data-settings-network-action="connect"]',
      );
      connect?.click();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      selectedNetworkSsid = null;
      networkManagementMessage = "";
      replaceView();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeHost = hostPort.subscribe((snapshot) => {
    hostSnapshot = validateSurfaceSnapshot(snapshot);
    replaceView();
  });
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    preferenceSnapshot = snapshot;
    replaceView();
  });
  const networkPoll = networkPort
    ? setInterval(() => void refreshNetwork(), 5000)
    : null;
  const networkManagementPoll = networkManagementPort
    ? setInterval(() => void refreshNetworkManagement(), 5000)
    : null;
  if (networkPort) void refreshNetwork();
  if (networkManagementPort) void refreshNetworkManagement();

  return Object.freeze({
    destroy() {
      destroyed = true;
      if (networkPoll !== null) clearInterval(networkPoll);
      if (networkManagementPoll !== null) clearInterval(networkManagementPoll);
      unsubscribePreferences?.();
      unsubscribeHost?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      const slot = findSlot();
      if (slot?.dataset.ordaxSettingsOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxSettingsOverviewView;
      }
      mountedSlot = null;
    },
  });
}
