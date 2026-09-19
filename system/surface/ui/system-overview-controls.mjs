import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
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
import { PRODUCT_VERSION, productVersionLabel } from "../../contracts/product-version.mjs";
import {
  deliveryLabel,
  formatUpdateTimestamp,
  readableUpdateMode,
  readableUpdatePhase,
  shortSha,
  updateAttentionMessage,
  updateBootLabel,
  updateIsAlerting,
  updateStatusLabel,
  updateSummaryDetail,
  updateSummaryLabel,
} from "../../services/update/presentation.mjs";
import { mountSystemDiagnosticsReview } from "./system-diagnostics-review.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const SYSTEM_WINDOW_SELECTOR = '[data-window-id="system"]';
const SYSTEM_EXTENSION_SELECTOR = '[data-app-extension="system-overview"]';

const SYSTEM_SECTIONS = Object.freeze([
  Object.freeze({ id: "overview", label: "Visão geral" }),
  Object.freeze({ id: "updates", label: "Atualizações" }),
  Object.freeze({ id: "storage", label: "Armazenamento" }),
  Object.freeze({ id: "diagnostics", label: "Diagnóstico" }),
  Object.freeze({ id: "about", label: "Sobre" }),
]);

const SECTION_COPY = Object.freeze({
  overview: Object.freeze({
    title: "Visão geral",
    subtitle: "Estado atual do OrdaX, conectividade e sinais que exigem atenção.",
  }),
  updates: Object.freeze({
    title: "Atualizações",
    subtitle: "Entrega observada, aplicação, recuperação e histórico deste dispositivo.",
  }),
  storage: Object.freeze({
    title: "Armazenamento",
    subtitle: "Espaço do usuário medido pelo host, sem inferir a capacidade de outros volumes.",
  }),
  diagnostics: Object.freeze({
    title: "Diagnóstico",
    subtitle: "Capacidades desta execução e, quando disponível, uma revisão local explícita e sanitizada.",
  }),
  about: Object.freeze({
    title: "Sobre",
    subtitle: "Identidade da entrega e limites de versionamento dos componentes do OrdaX.",
  }),
});

function validSystemSection(value) {
  return SYSTEM_SECTIONS.some((section) => section.id === value);
}

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

function formatObservationReceivedAt(value) {
  if (!Number.isFinite(value)) return "horário desconhecido";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
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
  appActivation = null,
  diagnosticReviewController = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("System overview controls require a Surface root Element");
  }

  const hostPort = assertSurfaceHost(host);
  const updatePort = updateStatusPort === null ? null : assertUpdateStatusPort(updateStatusPort);
  const metricsPort = systemMetrics === null ? null : assertSystemMetricsPort(systemMetrics);
  const historyPort = updateHistory === null ? null : assertUpdateHistoryPort(updateHistory);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let updateSnapshot = updatePort?.getSnapshot();
  if (updateSnapshot !== null && updateSnapshot !== undefined) {
    updateSnapshot = validateUpdateStatusSnapshot(updateSnapshot);
  }
  let metricsSnapshot = null;
  let metricsPending = false;
  let metricsReadFailed = false;
  let metricsLastSuccessAt = null;
  let metricsMessage = "";
  let metricsOrdinal = 0;
  let historySnapshot = null;
  let historyMessage = "";
  let historyOrdinal = 0;
  let activeSection = validSystemSection(lifecycle.getAppTarget("system"))
    ? lifecycle.getAppTarget("system")
    : "overview";
  let destroyed = false;
  let mountedSlot = null;
  let diagnosticsReviewMount = null;

  const findSlot = () =>
    root.querySelector(`${SYSTEM_WINDOW_SELECTOR} ${SYSTEM_EXTENSION_SELECTOR}`);

  const disposeDiagnosticsReview = () => {
    diagnosticsReviewMount?.dispose();
    diagnosticsReviewMount = null;
  };

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.systemSection) {
      return Object.freeze({ kind: "section", value: element.dataset.systemSection });
    }
    if (element.dataset.systemOverviewRefresh !== undefined) {
      return Object.freeze({ kind: "metrics-refresh", value: "" });
    }
    if (element.dataset.systemHistoryRefresh !== undefined) {
      return Object.freeze({ kind: "history-refresh", value: "" });
    }
    if (element.dataset.systemDiagnosticsPrepare !== undefined) {
      return Object.freeze({ kind: "diagnostics-prepare", value: "" });
    }
    if (element.dataset.systemDiagnosticsCopy !== undefined) {
      return Object.freeze({ kind: "diagnostics-copy", value: "" });
    }
    if (element.dataset.systemDiagnosticsExport !== undefined) {
      return Object.freeze({ kind: "diagnostics-export", value: "" });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    for (const element of slot.querySelectorAll("button")) {
      const candidate = focusIdentity(element);
      if (
        candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
      ) {
        return element;
      }
    }
    return null;
  };

  const captureInteractionState = (slot) => {
    const windowBody = slot.closest(".ordax-window-body");
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && slot.contains(activeElement);
    return Object.freeze({
      section: slot.dataset.systemActiveSection ?? "",
      windowScrollTop: windowBody?.scrollTop ?? 0,
      windowScrollLeft: windowBody?.scrollLeft ?? 0,
      focus: activeInside ? focusIdentity(activeElement) : null,
    });
  };

  const restoreInteractionState = (slot, snapshot) => {
    const sameSection = Boolean(snapshot) && snapshot.section === activeSection;
    if (!sameSection) return;

    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody) {
      windowBody.scrollTop = snapshot.windowScrollTop;
      windowBody.scrollLeft = snapshot.windowScrollLeft;
    }

    const target = findFocusTarget(slot, snapshot.focus);
    if (!target || target.disabled) return;
    target.focus({ preventScroll: true });
  };

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-system-header");
    const copy = node(documentObject, "div", "ordax-system-header-copy");
    const sectionCopy = SECTION_COPY[activeSection];
    copy.append(
      node(documentObject, "span", "ordax-system-eyebrow", "Sistema"),
      node(documentObject, "h3", "ordax-system-title", sectionCopy.title),
      node(documentObject, "p", "ordax-system-subtitle", sectionCopy.subtitle),
    );

    const health = node(documentObject, "span", "ordax-system-health");
    const alerting = updateIsAlerting(updateSnapshot);
    health.dataset.state =
      alerting || hostSnapshot.connectivity === "offline"
        ? "attention"
        : "observed";
    health.textContent = updateSnapshot?.bootRefreshRequired
      ? "Atualização de base pendente"
      : alerting
        ? "Atenção na atualização"
        : hostSnapshot.connectivity === "offline"
          ? "Sem conexão"
          : updateSnapshot
            ? updateStatusLabel(updateSnapshot.status)
            : "Surface ativa";
    header.append(copy, health);
    view.append(header);
  };

  const renderSectionNavigation = (view) => {
    const navigation = node(documentObject, "nav", "ordax-system-navigation");
    navigation.setAttribute("aria-label", "Seções de Sistema");
    for (const section of SYSTEM_SECTIONS) {
      const button = node(documentObject, "button", "ordax-system-navigation-item", section.label);
      button.type = "button";
      button.dataset.systemSection = section.id;
      const active = activeSection === section.id;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      navigation.append(button);
    }
    view.append(navigation);
  };

  const renderSummary = (view) => {
    const grid = node(documentObject, "section", "ordax-system-summary");
    grid.setAttribute("aria-label", "Resumo do sistema");

    appendMetricCard(documentObject, grid, {
      label: "Versão do protótipo",
      value: productVersionLabel(),
      detail: "Versão humana do produto · independente da Entrega e do SHA",
    });

    appendMetricCard(documentObject, grid, {
      label: "Entrega observada",
      value: updateSnapshot ? deliveryLabel(updateSnapshot.deliveryNumber) : "—",
      detail: updateSnapshot
        ? `SHA ${shortSha(updateSnapshot.sourceSha)} · ${readableUpdateMode(updateSnapshot.applyMode)}`
        : "Gerenciamento de entrega não exposto neste host",
    });

    appendMetricCard(documentObject, grid, {
      label: "Atualização",
      value: updateSnapshot
        ? updateSummaryLabel(updateSnapshot)
        : "Indisponível",
      detail: updateSnapshot?.bootRefreshRequired
        ? updateSummaryDetail(updateSnapshot)
        : updateSnapshot?.checkedAt && updateSnapshot.checkedAt !== "unknown"
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
      detail: !metricsPort
        ? "Métrica local indisponível"
        : metricsReadFailed && metricsSnapshot
          ? `Leitura anterior · recebida pela Surface às ${formatObservationReceivedAt(metricsLastSuccessAt)}`
          : metricsSnapshot
            ? `Leitura local · recebida às ${formatObservationReceivedAt(metricsLastSuccessAt)}`
            : "Aguardando leitura local",
    });

    view.append(grid);
  };

  const renderMemory = (view) => {
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Uso do dispositivo"),
      node(documentObject, "h4", "ordax-system-section-title", "Memória"),
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

    if (!metricsPort || !metricsSnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          metricsPort
            ? metricsPending
              ? "Lendo recursos do dispositivo…"
              : (metricsMessage || "Aguardando leitura local.")
            : "Este host não expõe métricas locais de memória.",
        ),
      );
      view.append(section);
      return;
    }

    if (metricsReadFailed) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-warning",
          `Leitura antiga · a tentativa atual falhou. Última leitura recebida pela Surface às ${formatObservationReceivedAt(metricsLastSuccessAt)}.`,
        ),
      );
    }

    const memoryUsed = metricsSnapshot.memoryTotalBytes - metricsSnapshot.memoryAvailableBytes;
    const resourceGrid = node(documentObject, "div", "ordax-system-resource-grid");
    appendMetricCard(documentObject, resourceGrid, {
      label: "Memória em uso",
      value: formatBytes(memoryUsed),
      detail: `${formatBytes(metricsSnapshot.memoryAvailableBytes)} disponível de ${formatBytes(metricsSnapshot.memoryTotalBytes)}`,
      progress: ratio(memoryUsed, metricsSnapshot.memoryTotalBytes),
    });
    section.append(resourceGrid);
    if (metricsMessage) section.append(node(documentObject, "p", "ordax-system-message", metricsMessage));
    view.append(section);
  };

  const renderStorage = (view) => {
    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Armazenamento"),
      node(documentObject, "h4", "ordax-system-section-title", "Espaço do usuário"),
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

    if (!metricsPort || !metricsSnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          metricsPort
            ? metricsPending
              ? "Lendo armazenamento do usuário…"
              : (metricsMessage || "Aguardando leitura local.")
            : "Este host não expõe a capacidade do espaço do usuário.",
        ),
      );
      view.append(section);
      return;
    }

    if (metricsReadFailed) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-warning",
          `Leitura antiga · a tentativa atual falhou. Última leitura recebida pela Surface às ${formatObservationReceivedAt(metricsLastSuccessAt)}.`,
        ),
      );
    }

    const storageUsed = metricsSnapshot.userStorageTotalBytes - metricsSnapshot.userStorageFreeBytes;
    const resourceGrid = node(documentObject, "div", "ordax-system-resource-grid");
    appendMetricCard(documentObject, resourceGrid, {
      label: "Espaço usado",
      value: formatBytes(storageUsed),
      detail: `${formatBytes(metricsSnapshot.userStorageFreeBytes)} livre de ${formatBytes(metricsSnapshot.userStorageTotalBytes)}`,
      progress: ratio(storageUsed, metricsSnapshot.userStorageTotalBytes),
    });
    section.append(resourceGrid);
    section.append(
      node(
        documentObject,
        "p",
        "ordax-system-section-copy",
        "Esta leitura cobre somente o espaço persistente do usuário exposto pelo host. Não representa o disco físico inteiro.",
      ),
    );
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

    addFact("Entrega", deliveryLabel(updateSnapshot.deliveryNumber));
    addFact("Commit técnico", shortSha(updateSnapshot.sourceSha));
    if (updateSnapshot.runtimeSurfaceSha) {
      addFact("Surface em execução", shortSha(updateSnapshot.runtimeSurfaceSha));
    }
    addFact("Estado", updateStatusLabel(updateSnapshot.status));
    addFact("Fase", readableUpdatePhase(updateSnapshot.phase));
    addFact("Aplicação", readableUpdateMode(updateSnapshot.applyMode));
    if (updateSnapshot.targetSha) {
      addFact("Alvo", shortSha(updateSnapshot.targetSha));
    }
    if (updateSnapshot.attemptId) {
      addFact("Tentativa", formatUpdateTimestamp(updateSnapshot.attemptId));
    }
    if (updateSnapshot.checkedAt && updateSnapshot.checkedAt !== "unknown") {
      addFact("Última verificação", formatUpdateTimestamp(updateSnapshot.checkedAt));
    }
    if (updateSnapshot.lastError) {
      addFact("Diagnóstico", updateSnapshot.lastError);
    }
    if (updateSnapshot.lastAppliedAt !== "unknown") {
      addFact("Última aplicação", formatUpdateTimestamp(updateSnapshot.lastAppliedAt));
      addFact("Duração", `${updateSnapshot.lastApplyDurationSeconds}s · preparação ${updateSnapshot.lastStageDurationSeconds}s`);
    }
    if (updateSnapshot.rejectedSha) {
      addFact("Commit bloqueado", shortSha(updateSnapshot.rejectedSha));
    }
    addFact("Boot", updateBootLabel(updateSnapshot));
    section.append(facts);

    if (updateIsAlerting(updateSnapshot)) {
      const warning = node(
        documentObject,
        "p",
        "ordax-system-warning",
        updateAttentionMessage(updateSnapshot),
      );
      section.append(warning);
    }

    view.append(section);
  };

  const renderComponentVersions = (view) => {
    const versionSection = node(documentObject, "section", "ordax-system-section");
    const versionHeading = node(documentObject, "div", "ordax-system-section-heading");
    const versionHeadingCopy = node(documentObject, "div");
    versionHeadingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Versão do produto"),
      node(documentObject, "h4", "ordax-system-section-title", productVersionLabel()),
    );
    versionHeading.append(versionHeadingCopy);
    versionSection.append(versionHeading);
    versionSection.append(
      node(
        documentObject,
        "p",
        "ordax-system-section-copy",
        "Esta é a versão humana do protótipo. Ela muda quando o produto atinge um novo marco funcional; Entrega e SHA continuam identificando atualizações e builds específicos.",
      ),
      node(
        documentObject,
        "p",
        "ordax-system-section-copy",
        PRODUCT_VERSION.stableRelease
          ? "Este marco é uma versão estável do produto."
          : "Canal de protótipo: v1.0 permanece reservado para o produto estável.",
      ),
    );
    view.append(versionSection);

    const section = node(documentObject, "section", "ordax-system-section");
    const heading = node(documentObject, "div", "ordax-system-section-heading");
    const headingCopy = node(documentObject, "div");
    headingCopy.append(
      node(documentObject, "span", "ordax-system-section-kicker", "Identidade da entrega"),
      node(
        documentObject,
        "h4",
        "ordax-system-section-title",
        updateSnapshot?.deliveryNumber ? deliveryLabel(updateSnapshot.deliveryNumber) : "Entrega não informada",
      ),
    );
    heading.append(headingCopy);
    section.append(heading);
    section.append(
      node(
        documentObject,
        "p",
        "ordax-system-section-copy",
        "Entrega é o número humano do que pode chegar ao notebook; não é número de PR nem versão comercial do OrdaX. O SHA identifica exatamente o build. Apps só recebem versão própria quando tiverem empacotamento e ciclo de release independentes.",
      ),
    );

    if (!updateSnapshot?.deliveryNumber) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-system-placeholder",
          "Este host não informa uma identidade técnica de entrega. A versão do produto permanece disponível separadamente.",
        ),
      );
      view.append(section);
      return;
    }

    const list = node(documentObject, "div", "ordax-system-version-grid");
    for (const label of [
      "Surface",
      "Arquivos",
      "Notas",
      "Internet",
      "Ajustes",
      "Conta",
      "Sistema",
      "Rede",
      "Atualizador",
    ]) {
      const item = node(documentObject, "div", "ordax-system-version-item");
      item.append(
        node(documentObject, "strong", "", label),
        node(
          documentObject,
          "span",
          "",
          `Distribuição conjunta · sem versão própria · OrdaX ${PRODUCT_VERSION.displayVersion}`,
        ),
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
          node(documentObject, "strong", "", `${deliveryLabel(entry.deliveryNumber)} · ${result}`),
          node(documentObject, "span", "", formatUpdateTimestamp(entry.appliedAt)),
          node(
            documentObject,
            "small",
            "",
            `SHA ${shortSha(entry.sourceSha)} · ${readableUpdateMode(entry.applyMode)} · ${entry.applyDurationSeconds}s (preparação ${entry.stageDurationSeconds}s)`,
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
        node(documentObject, "strong", "", `${deliveryLabel(entry.deliveryNumber)} · ${entry.title}`),
        node(documentObject, "span", "", formatUpdateTimestamp(entry.releasedAt)),
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

  const renderDiagnosticReviewMount = (view) => {
    if (diagnosticReviewController === null) return null;
    const mount = node(documentObject, "div", "");
    mount.dataset.systemDiagnosticsReviewMount = "";
    view.append(mount);
    return mount;
  };

  const paint = (slot, interaction = null) => {
    disposeDiagnosticsReview();
    slot.replaceChildren();
    slot.dataset.ordaxSystemOverviewView = "";
    slot.dataset.systemActiveSection = activeSection;

    const view = node(documentObject, "div", "ordax-system-view");
    renderHeader(view);
    renderSectionNavigation(view);
    let diagnosticMount = null;

    if (activeSection === "overview") {
      renderSummary(view);
      renderMemory(view);
    } else if (activeSection === "updates") {
      renderUpdateDetails(view);
      renderHistory(view);
    } else if (activeSection === "storage") {
      renderStorage(view);
    } else if (activeSection === "diagnostics") {
      diagnosticMount = renderDiagnosticReviewMount(view);
      renderCapabilities(view);
    } else if (activeSection === "about") {
      renderComponentVersions(view);
    }
    slot.append(view);

    if (diagnosticMount) {
      diagnosticsReviewMount = mountSystemDiagnosticsReview(
        diagnosticMount,
        diagnosticReviewController,
      );
    }
    restoreInteractionState(slot, interaction);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      disposeDiagnosticsReview();
      mountedSlot = null;
      return;
    }
    if (!force && mountedSlot === slot) return;
    const interaction =
      force && slot === mountedSlot ? captureInteractionState(slot) : null;
    mountedSlot = slot;
    paint(slot, interaction);
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
      metricsReadFailed = false;
      metricsLastSuccessAt = Date.now();
    } catch {
      if (destroyed || ordinal !== metricsOrdinal) return;
      metricsReadFailed = true;
      metricsMessage = metricsSnapshot
        ? "A leitura atual falhou; os valores abaixo são a última leitura válida recebida pela Surface."
        : "Não foi possível obter uma leitura válida dos recursos nesta sessão.";
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
    const section = event.target.closest("[data-system-section]");
    if (section && root.contains(section) && validSystemSection(section.dataset.systemSection)) {
      const nextSection = section.dataset.systemSection;
      if (activationPort) {
        activationPort.publish({ appId: "system", target: nextSection });
      } else {
        activeSection = nextSection;
        replaceView();
      }
      return;
    }

    const refresh = event.target.closest("[data-system-overview-refresh]");
    if (refresh && root.contains(refresh)) {
      void refreshMetrics();
      return;
    }
    const historyRefresh = event.target.closest("[data-system-history-refresh]");
    if (historyRefresh && root.contains(historyRefresh)) void refreshHistory();
  };

  root.addEventListener("click", onClick);
  const unsubscribeRender = lifecycle.subscribeRender(() => {
    const persistedTarget = lifecycle.getAppTarget("system");
    const nextSection = validSystemSection(persistedTarget) ? persistedTarget : "overview";
    activeSection = nextSection;
    renderView(false);
  });
  const unsubscribeHost = hostPort.subscribe((snapshot) => {
    hostSnapshot = validateSurfaceSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (
      activation.appId === "system"
      && activation.target !== null
      && validSystemSection(activation.target)
    ) {
      activeSection = activation.target;
      replaceView();
    }
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
      disposeDiagnosticsReview();
      unsubscribeUpdate?.();
      unsubscribeActivation?.();
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
