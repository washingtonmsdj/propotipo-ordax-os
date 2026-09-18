import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import {
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import { listPreferenceDefinitions } from "../../services/preferences/catalog.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const SETTINGS_WINDOW_SELECTOR = '[data-window-id="settings"]';
const SETTINGS_EXTENSION_SELECTOR = '[data-app-extension="settings-overview"]';

const CAPABILITY_LABELS = Object.freeze({
  "network.https": "Rede HTTPS",
  "network.status": "Estado local de rede",
  "filesystem.user-space": "Arquivos persistentes",
  "system.boot-control": "Energia do dispositivo",
  "system.metrics": "Métricas locais",
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
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Settings overview controls require a Surface root Element");
  }
  const hostPort = assertSurfaceHost(host);
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const networkPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let preferenceSnapshot = preferences.getSnapshot();
  let networkSnapshot = null;
  let networkReadFailed = false;
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${SETTINGS_WINDOW_SELECTOR} ${SETTINGS_EXTENSION_SELECTOR}`);

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-settings-header");
    header.append(
      node(documentObject, "span", "ordax-settings-eyebrow", "OrdaX"),
      node(documentObject, "h3", "ordax-settings-title", "Configurações"),
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

  const renderNetwork = (view) => {
    if (!networkPort) return;

    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsNetwork = "";
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", "Rede"),
      node(documentObject, "h4", "ordax-settings-section-title", "Rede e conexões"),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        "Estado real observado no host nativo. Somente leitura nesta etapa; conexão, troca e esquecimento de Wi-Fi entram no próximo incremento.",
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

    if (networkReadFailed) {
      section.append(
        node(documentObject, "p", "ordax-settings-empty", "Não foi possível atualizar o estado de rede."),
      );
      view.append(section);
      return;
    }

    if (networkSnapshot === null) {
      section.append(node(documentObject, "p", "ordax-settings-empty", "Lendo interfaces de rede…"));
      view.append(section);
      return;
    }

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

  const onClick = (event) => {
    const button = event.target.closest("[data-settings-preference-id]");
    if (!button || !root.contains(button)) return;
    preferences.set(
      button.dataset.settingsPreferenceId,
      button.dataset.settingsPreferenceValue,
    );
  };

  root.addEventListener("click", onClick);
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
  if (networkPort) void refreshNetwork();

  return Object.freeze({
    destroy() {
      destroyed = true;
      if (networkPoll !== null) clearInterval(networkPoll);
      unsubscribePreferences?.();
      unsubscribeHost?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      const slot = findSlot();
      if (slot?.dataset.ordaxSettingsOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxSettingsOverviewView;
      }
      mountedSlot = null;
    },
  });
}
