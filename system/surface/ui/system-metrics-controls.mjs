import {
  assertSystemMetricsPort,
  validateSystemMetricsSnapshot,
} from "../../contracts/system-metrics.mjs";

const SYSTEM_WINDOW_SELECTOR = '[data-window-id="system"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit >= 3 && value < 10 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function mountSystemMetricsControls(root, systemMetrics = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("System metrics controls require a Surface root Element");
  }
  const port = systemMetrics === null ? null : assertSystemMetricsPort(systemMetrics);
  if (!port) return Object.freeze({ destroy() {} });

  const documentObject = root.ownerDocument;
  const Observer = documentObject.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  let snapshot = null;
  let pending = false;
  let message = null;
  let destroyed = false;
  let readOrdinal = 0;

  const renderPanel = () => {
    if (destroyed) return;
    const body = root.querySelector(`${SYSTEM_WINDOW_SELECTOR} .ordax-window-body`);
    if (!body || body.querySelector("[data-ordax-system-metrics-panel]")) return;

    const section = node(documentObject, "section", "ordax-app-panel");
    section.dataset.ordaxSystemMetricsPanel = "";
    section.append(node(documentObject, "span", "ordax-app-panel-label", "Recursos"));
    section.append(node(documentObject, "h3", "ordax-app-panel-title", "Estado do dispositivo"));

    const badge = node(
      documentObject,
      "span",
      "ordax-inline-status",
      pending ? "Atualizando…" : snapshot ? "Leitura local" : "Aguardando leitura…",
    );
    badge.dataset.state = snapshot ? "available" : "unavailable";
    section.append(badge);

    if (snapshot) {
      const usedMemory = snapshot.memoryTotalBytes - snapshot.memoryAvailableBytes;
      const facts = node(documentObject, "ul", "ordax-capability-list");
      facts.append(node(documentObject, "li", "", `Tempo ligado: ${formatUptime(snapshot.uptimeSeconds)}`));
      facts.append(
        node(
          documentObject,
          "li",
          "",
          `Memória: ${formatBytes(usedMemory)} em uso · ${formatBytes(snapshot.memoryAvailableBytes)} disponível · ${formatBytes(snapshot.memoryTotalBytes)} total`,
        ),
      );
      facts.append(
        node(
          documentObject,
          "li",
          "",
          `Espaço do usuário: ${formatBytes(snapshot.userStorageFreeBytes)} livre de ${formatBytes(snapshot.userStorageTotalBytes)}`,
        ),
      );
      section.append(facts);
    }

    const refresh = node(documentObject, "button", "ordax-preference-choice", pending ? "Atualizando…" : "Atualizar leitura");
    refresh.type = "button";
    refresh.dataset.systemMetricsRefresh = "";
    refresh.disabled = pending;
    section.append(refresh);

    if (message) section.append(node(documentObject, "p", "ordax-empty", message));
    section.append(
      node(
        documentObject,
        "p",
        "ordax-app-panel-body",
        "Somente métricas agregadas e somente leitura atravessam este contrato; detalhes de /proc, hardware e caminhos internos não são expostos à Surface.",
      ),
    );
    body.append(section);
  };

  const replacePanel = () => {
    root.querySelector(`${SYSTEM_WINDOW_SELECTOR} [data-ordax-system-metrics-panel]`)?.remove();
    renderPanel();
  };

  const refresh = async () => {
    const ordinal = ++readOrdinal;
    pending = true;
    message = null;
    replacePanel();
    try {
      const next = validateSystemMetricsSnapshot(await port.read());
      if (destroyed || ordinal !== readOrdinal) return;
      snapshot = next;
    } catch {
      if (destroyed || ordinal !== readOrdinal) return;
      message = "Não foi possível ler os recursos do dispositivo agora.";
    } finally {
      if (!destroyed && ordinal === readOrdinal) {
        pending = false;
        replacePanel();
      }
    }
  };

  const onClick = (event) => {
    const button = event.target.closest("[data-system-metrics-refresh]");
    if (button && root.contains(button)) void refresh();
  };

  const observer = new Observer(() => renderPanel());
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", onClick);
  void refresh();

  return Object.freeze({
    destroy() {
      destroyed = true;
      readOrdinal += 1;
      observer.disconnect();
      root.removeEventListener("click", onClick);
      root.querySelector(`${SYSTEM_WINDOW_SELECTOR} [data-ordax-system-metrics-panel]`)?.remove();
    },
  });
}
