import {
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import {
  assertSystemMetricsPort,
  validateSystemMetricsSnapshot,
} from "../../contracts/system-metrics.mjs";
import {
  assertUpdateHistoryPort,
  validateUpdateHistorySnapshot,
} from "../../contracts/update-history.mjs";
import {
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const SYSTEM_WINDOW_SELECTOR = '[data-window-id="system"]';
const SYSTEM_EXTENSION_SELECTOR = '[data-app-extension="system-overview"]';

const UPDATE_LABELS = Object.freeze({
  running: "Atualizado",
  applied: "Atualização aplicada",
  updating: "Atualizando",
  "network-error": "Sem conexão para atualizar",
  "remote-error": "Git remoto indisponível",
  "pull-error": "Falha ao atualizar",
  "rolled-back": "Atualização revertida",
  rejected: "Versão bloqueada",
  pinned: "Versão fixada",
  disabled: "Atualização indisponível",
  unavailable: "Estado indisponível",
});

const CAPABILITY_LABELS = Object.freeze({
  "network.https": "Rede HTTPS",
  "network.status": "Estado local de rede",
  "network.management": "Gerenciamento de Wi-Fi",
  "system.boot-control": "Energia do dispositivo",
  "filesystem.user-space": "Espaço local do usuário",
  "system.metrics": "Métricas do dispositivo",
  "power.status": "Estado da bateria",
});

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortSha(value) {
  if (typeof value !== "string" || value.length < 8 || value === "unavailable") return "—";
  return value.slice(0, 8);
}

function versionLabel(value) {
  return Number.isSafeInteger(value) && value > 0 ? `v${value}` : "Sem versão humana";
}

function formatTimestamp(value) {
  if (typeof value !== "string" || !value || value === "unknown") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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

function readableMode(mode) {
  switch (mode) {
    case "reload": return "Recarga rápida da Surface";
    case "surface-restart": return "Reinício somente da Surface";
    case "supervisor-restart": return "Reinício do supervisor";
    case "initial": return "Inicialização";
    default: return "Sem ação pendente";
  }
}

function updateIsAlerting(snapshot) {
  return Boolean(snapshot?.bootRefreshRequired) || [
    "network-error",
    "remote-error",
    "pull-error",
    "rolled-back",
    "rejected",
  ].includes(snapshot?.status);
}

function ratio(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, used / total));
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function appendMetricCard(documentObject, container, { label, value, detail = "", progress = null }) {
  const card = node(documentObject, "article", "ordax-system-card");
  card.append(node(documentObject, "span", "ordax-system-card-label", label));
  card.append(node(documentObject, "strong", "ordax-system-card-value", value));
  if (progress !== null) {
    const track = node(documentObject, "span", "ordax-system-meter");
    const fill = node(documentObject, "span", "ordax-system-meter-fill");
    fill.style.setProperty("--ordax-system-meter-value", percent(progress));
    track.append(fill);
    card.append(track);
  }
  if (detail) card.append(node(documentObject, "small", "ordax-system-card-detail", detail));
  container.append(card);
}

export function mountSystemOverviewControls(
  root,
  host,
  updateStatusPort = null,
  systemMetrics = null,
  surfaceLifecycle = null,
  updateHistory = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("System overview controls require a Surface root Element");
  }

  const hostPort = assertSurfaceHost(host);
  const updatePort = updateStatusPort === null ? null : assertUpdateStatusPort(updateStatusPort);
  const metricsPort = systemMetrics === null ? null : assertSystemMetricsPort(systemMetrics);
  const historyPort = updateHistory === null ? null : assertUpdateHistoryPort(updateHistory);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let updateSnapshot = updatePort?.getSnapshot();
  if (updateSnapshot !== null && updateSnapshot !== undefined) {
    updateSnapshot = validateUpdateStatusSnapshot(updateSnapshot);
  }
  let metricsSnapshot = null;
  let metricsPending = false;
  let metricsMessage = "";
  let metricsOrdinal = 0;
  let historySnapshot = null;
  let historyMessage = "";
  let historyOrdinal = 0;
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${SYSTEM_WINDOW_SELECTOR} ${SYSTEM_EXTENSION_SELECTOR}`);

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-system-header");
    const copy = node(documentObject, "div", "ordax-system-header-copy");
    copy.append(
      node(documentObject, "span", "ordax-system-eyebrow", "OrdaX"),
      node(documentObject, "h3", "ordax-system-title", "Estado do sistema"),
      node(
        documentObject,
        "p",
        "ordax-system-subtitle",
        "Versão, saúde da atualização e recursos expostos por contratos neutros.",
      ),
    );

    const health = node(documentObject, "span", "ordax-system-health");
    const alerting = updateIsAlerting(updateSnapshot);
    health.dataset.state = alerting
      ? "attention"
      : hostSnapshot.connectivity === "offline"
        ? "attention"
        : "healthy";
    health.textContent = alerting
      ? "Atenção necessária"
      : hostSnapshot.connectivity === "offline"
        ? "Offline"
        : updateSnapshot
          ? "Operando normalmente"
          : "Surface ativa";
    header.append(copy, health);
    view.append(header);
  };

  const renderSummary = (view) => {
    const grid = node(documentObject, "section", "ordax-system-summary");
    grid.setAttribute("aria-label", "Resumo do sistema");

    appendMetricCard(documentObject, grid, {
      label: "Versão em execução",
      value: updateSnapshot ? versionLabel(updateSnapshot.versionNumber) : "—",
      detail: updateSnapshot
        ? `SHA ${shortSha(updateSnapshot.sourceSha)} · ${readableMode(updateSnapshot.applyMode)}`
        : "Gerenciamento de versão não exposto neste host",
    });

    appendMetricCard(documentObject, grid, {
      label: "Atualização",
      value: updateSnapshot
        ? updateSnapshot.bootRefreshRequired
          ? "Reinício necessário"
          : UPDATE_LABELS[updateSnapshot.status] ?? updateSnapshot.status
        : "Indisponível",
      detail: updateSnapshot?.checkedAt && updateSnapshot.checkedAt !== "unknown"
        ? `Verificado: ${updateSnapshot.checkedAt}`
        : "Sem estado de atualização publicado",
    });

    appendMetricCard(documentObject, grid, {
      label: "Conectividade",
      value: hostSnapshot.connectivity === "online"
        ? "Online"
        : hostSnapshot.connectivity === "offline"
          ? "Offline"
          : "Desconhecida",
      detail: `${hostSnapshot.capabilityIds.length} capacidades ativas`,
    });

    appendMetricCard(documentObject, grid, {
      label: "Tempo ligado",
      value: metricsSnapshot ? formatUptime(metricsSnapshot.uptimeSeconds) : "—",
      detail: metricsPort ? "Leitura local do dispositivo" : "Métrica local indisponível",
    });

    view.append(grid);
  };

  const renderResources = (view) => {
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Recursos"),
      node(documentObject, "h4", "ordax-system-section-title", "Uso do dispositivo"),
    );

    const refresh = node(
      documentObject,
      "button",
      "ordax-system-action",
      metricsPending ? "Atualizando…" : "Atualizar leitura",
    );
    refresh.type = "button";
    refresh.dataset.systemOverviewRefresh = "";
    refresh.disabled = metricsPending || !metricsPort;
    heading.append(headingCopy, refresh);
    section.append(heading);

    if (!metricsPort) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          "Este host não expõe métricas locais de memória e armazenamento.",
        ),
      );
      view.append(section);
      return;
    }

    if (!metricsSnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          metricsPending ? "Lendo recursos do dispositivo…" : (metricsMessage || "Aguardando leitura local."),
        ),
      );
      view.append(section);
      return;
    }

    const memoryUsed = metricsSnapshot.memoryTotalBytes - metricsSnapshot.memoryAvailableBytes;
    const storageUsed = metricsSnapshot.userStorageTotalBytes - metricsSnapshot.userStorageFreeBytes;
    const resourceGrid = node(documentObject, "div", "ordax-system-resource-grid");

    appendMetricCard(documentObject, resourceGrid, {
      label: "Memória",
      value: formatBytes(memoryUsed),
      detail: `${formatBytes(metricsSnapshot.memoryAvailableBytes)} disponível de ${formatBytes(metricsSnapshot.memoryTotalBytes)}`,
      progress: ratio(memoryUsed, metricsSnapshot.memoryTotalBytes),
    });
    appendMetricCard(documentObject, resourceGrid, {
      label: "Espaço do usuário",
      value: formatBytes(storageUsed),
      detail: `${formatBytes(metricsSnapshot.userStorageFreeBytes)} livre de ${formatBytes(metricsSnapshot.userStorageTotalBytes)}`,
      progress: ratio(storageUsed, metricsSnapshot.userStorageTotalBytes),
    });
    section.append(resourceGrid);
    if (metricsMessage) section.append(node(documentObject, "p", "ordax-system-message", metricsMessage));
    view.append(section);
  };

  const renderUpdateDetails = (view) => {
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Atualização"),
      node(documentObject, "h4", "ordax-system-section-title", "Entrega e recuperação"),
    );
    heading.append(headingCopy);
    section.append(heading);

    if (!updateSnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          "Este host não publica o estado do supervisor de atualizações.",
        ),
      );
      view.append(section);
      return;
    }

    const facts = node(documentObject, "dl", "ordax-system-facts");
    const addFact = (label, value) => {
      const item = node(documentObject, "div", "ordax-system-fact");
      item.append(
        node(documentObject, "dt", "", label),
        node(documentObject, "dd", "", value),
      );
      facts.append(item);
    };

    addFact("Versão", versionLabel(updateSnapshot.versionNumber));
    addFact("Commit técnico", shortSha(updateSnapshot.sourceSha));
    addFact("Aplicação", readableMode(updateSnapshot.applyMode));
    if (updateSnapshot.lastAppliedAt !== "unknown") {
      addFact("Última aplicação", formatTimestamp(updateSnapshot.lastAppliedAt));
      addFact("Duração", `${updateSnapshot.lastApplyDurationSeconds}s · preparação ${updateSnapshot.lastStageDurationSeconds}s`);
    }
    if (updateSnapshot.rejectedSha) {
      addFact("Commit bloqueado", shortSha(updateSnapshot.rejectedSha));
    }
    addFact(
      "Boot",
      updateSnapshot.bootRefreshRequired
        ? "Mudança pendente de reinício físico"
        : "Nenhum reinício físico pendente",
    );
    section.append(facts);

    if (updateIsAlerting(updateSnapshot)) {
      const warning = node(
        documentObject,
        "p",
        "ordax-system-warning",
        updateSnapshot.bootRefreshRequired
          ? "Existe uma atualização de boot/bootstrap pendente. O OrdaX não reiniciará a máquina automaticamente."
          : "A versão atual permanece preservada enquanto o atualizador tenta recuperar um estado saudável.",
      );
      section.append(warning);
    }

    view.append(section);
  };

  const renderComponentVersions = (view) => {
    if (!updateSnapshot?.versionNumber) return;
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    const globalVersion = `OrdaX ${versionLabel(updateSnapshot.versionNumber)}`;
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Versão global"),
      node(documentObject, "h4", "ordax-system-section-title", globalVersion),
    );
    heading.append(headingCopy);
    section.append(heading);
    section.append(
      node(
        documentObject,
        "p",
        "ordax-system-section-copy",
        "Esta é a versão da entrega instalada no dispositivo. Surface, apps e serviços abaixo fazem parte da mesma release; um componente só terá versão própria se passar a ser distribuído separadamente.",
      ),
    );

    const list = node(documentObject, "div", "ordax-system-version-grid");
    for (const label of ["Surface", "Arquivos", "Ajustes", "Conta", "Sistema", "Rede", "Atualizador"]) {
      const item = node(documentObject, "div", "ordax-system-version-item");
      item.append(
        node(documentObject, "strong", "", label),
        node(documentObject, "span", "", "Incluído nesta entrega"),
      );
      list.append(item);
    }
    section.append(list);
    view.append(section);
  };

  const renderHistory = (view) => {
    if (!historyPort) return;
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Registro"),
      node(documentObject, "h4", "ordax-system-section-title", "Histórico de atualizações"),
    );
    const refresh = node(documentObject, "button", "ordax-system-action", "Atualizar histórico");
    refresh.type = "button";
    refresh.dataset.systemHistoryRefresh = "";
    heading.append(headingCopy, refresh);
    section.append(heading);

    if (!historySnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          historyMessage || "Lendo histórico persistente deste dispositivo…",
        ),
      );
      view.append(section);
      return;
    }

    const applications = node(documentObject, "div", "ordax-system-history");
    applications.append(node(documentObject, "h5", "ordax-system-history-title", "Aplicações neste notebook"));
    if (historySnapshot.applications.length === 0) {
      applications.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          "O registro local começa nesta geração do atualizador. Versões anteriores continuam listadas no histórico de entregas.",
        ),
      );
    } else {
      for (const entry of historySnapshot.applications.slice(0, 10)) {
        const item = node(documentObject, "article", "ordax-system-history-item");
        const result = entry.result === "applied" ? "Aplicada" : "Revertida";
        item.append(
          node(documentObject, "strong", "", `${versionLabel(entry.versionNumber)} · ${result}`),
          node(documentObject, "span", "", formatTimestamp(entry.appliedAt)),
          node(
            documentObject,
            "small",
            "",
            `SHA ${shortSha(entry.sourceSha)} · ${readableMode(entry.applyMode)} · ${entry.applyDurationSeconds}s (preparação ${entry.stageDurationSeconds}s)`,
          ),
        );
        applications.append(item);
      }
    }

    const releases = node(documentObject, "div", "ordax-system-history");
    releases.append(node(documentObject, "h5", "ordax-system-history-title", "Entregas do OrdaX"));
    for (const entry of historySnapshot.releases.slice(0, 12)) {
      const item = node(documentObject, "article", "ordax-system-history-item");
      item.append(
        node(documentObject, "strong", "", `${versionLabel(entry.versionNumber)} · ${entry.title}`),
        node(documentObject, "span", "", formatTimestamp(entry.releasedAt)),
        node(documentObject, "small", "", `SHA ${shortSha(entry.sourceSha)}`),
      );
      releases.append(item);
    }

    section.append(applications, releases);
    if (historyMessage) section.append(node(documentObject, "p", "ordax-system-message", historyMessage));
    view.append(section);
  };

  const renderCapabilities = (view) => {
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Contrato"),
      node(documentObject, "h4", "ordax-system-section-title", "Capacidades desta execução"),
    );
    heading.append(headingCopy);
    section.append(heading);

    const list = node(documentObject, "div", "ordax-system-capabilities");
    if (hostSnapshot.capabilityIds.length === 0) {
      list.append(node(documentObject, "p", "ordax-system-placeholder", "Nenhuma capacidade adicional declarada."));
    } else {
      for (const capabilityId of hostSnapshot.capabilityIds) {
        const item = node(documentObject, "div", "ordax-system-capability");
        item.append(
          node(documentObject, "span", "ordax-system-capability-dot"),
          node(documentObject, "strong", "", CAPABILITY_LABELS[capabilityId] ?? capabilityId),
          node(documentObject, "small", "", capabilityId),
        );
        list.append(item);
      }
    }
    section.append(list);
    view.append(section);
  };

  const paint = (slot) => {
    slot.replaceChildren();
    slot.dataset.ordaxSystemOverviewView = "";

    const view = node(documentObject, "div", "ordax-system-view");
    renderHeader(view);
    renderSummary(view);
    renderResources(view);
    renderUpdateDetails(view);
    renderComponentVersions(view);
    renderHistory(view);
    renderCapabilities(view);
    slot.append(view);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && mountedSlot === slot) return;
    mountedSlot = slot;
    paint(slot);
  };

  const replaceView = () => renderView(true);

  const refreshMetrics = async () => {
    if (!metricsPort || metricsPending) return;
    const ordinal = ++metricsOrdinal;
    metricsPending = true;
    metricsMessage = "";
    replaceView();
    try {
      const next = validateSystemMetricsSnapshot(await metricsPort.read());
      if (destroyed || ordinal !== metricsOrdinal) return;
      metricsSnapshot = next;
    } catch {
      if (destroyed || ordinal !== metricsOrdinal) return;
      metricsMessage = "Não foi possível atualizar a leitura dos recursos.";
    } finally {
      if (!destroyed && ordinal === metricsOrdinal) {
        metricsPending = false;
        replaceView();
      }
    }
  };

  const refreshHistory = async () => {
    if (!historyPort) return;
    const ordinal = ++historyOrdinal;
    historyMessage = "";
    try {
      const next = validateUpdateHistorySnapshot(await historyPort.list());
      if (destroyed || ordinal !== historyOrdinal) return;
      historySnapshot = next;
    } catch {
      if (destroyed || ordinal !== historyOrdinal) return;
      historyMessage = "Não foi possível atualizar o histórico local.";
    } finally {
      if (!destroyed && ordinal === historyOrdinal) replaceView();
    }
  };

  const onClick = (event) => {
    const refresh = event.target.closest("[data-system-overview-refresh]");
    if (refresh && root.contains(refresh)) {
      void refreshMetrics();
      return;
    }
    const historyRefresh = event.target.closest("[data-system-history-refresh]");
    if (historyRefresh && root.contains(historyRefresh)) void refreshHistory();
  };

  root.addEventListener("click", onClick);
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeHost = hostPort.subscribe((snapshot) => {
    hostSnapshot = validateSurfaceSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeUpdate = updatePort?.subscribe((snapshot) => {
    const previousAppliedSha = updateSnapshot?.lastAppliedSha ?? "";
    updateSnapshot = validateUpdateStatusSnapshot(snapshot);
    replaceView();
    if (historyPort && updateSnapshot.lastAppliedSha !== previousAppliedSha) {
      void refreshHistory();
    }
  });

  if (metricsPort) void refreshMetrics();
  if (historyPort) void refreshHistory();

  return Object.freeze({
    destroy() {
      destroyed = true;
      metricsOrdinal += 1;
      historyOrdinal += 1;
      unsubscribeUpdate?.();
      unsubscribeHost?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      const slot = findSlot();
      if (slot?.dataset.ordaxSystemOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxSystemOverviewView;
      }
      mountedSlot = null;
    },
  });
}
