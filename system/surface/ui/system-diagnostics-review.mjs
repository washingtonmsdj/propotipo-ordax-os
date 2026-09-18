import {
  DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA,
  DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
} from "../../services/diagnostics/controller.mjs";
import {
  deliveryLabel,
  formatUpdateTimestamp,
  readableUpdatePhase,
  updateStatusLabel,
} from "../../services/update/presentation.mjs";

const CONTROLLER_PHASES = new Set(["idle", "preparing", "ready", "copying", "exporting"]);

const SOURCE_LABELS = Object.freeze({
  surface: "Surface",
  update: "Atualização",
  metrics: "Métricas locais",
  history: "Histórico de atualizações",
  journal: "Eventos diagnósticos",
});

const SOURCE_STATUS_LABELS = Object.freeze({
  included: "Incluída",
  unavailable: "Indisponível",
  failed: "Falha na leitura",
});

const FAILURE_LABELS = Object.freeze({
  "surface-read-failed": "A Surface não pôde ser observada nesta revisão.",
  "update-read-failed": "O estado de atualização não pôde ser lido.",
  "metrics-read-failed": "As métricas locais não puderam ser lidas.",
  "history-read-failed": "O histórico de atualizações não pôde ser lido.",
  "journal-read-failed": "Os eventos diagnósticos não puderam ser lidos.",
});

const LAST_RESULT_LABELS = Object.freeze({
  "review-prepare-failed": "Não foi possível preparar a revisão local. Tente novamente.",
  "copy-unavailable": "Copiar resumo não está disponível neste modo.",
  "copy-in-progress": "O resumo sanitizado já está sendo copiado.",
  "copy-failed": "Não foi possível copiar o resumo sanitizado. A revisão continua disponível para nova tentativa.",
  "export-unavailable": "Salvar diagnóstico não está disponível neste modo.",
  "export-in-progress": "O diagnóstico já está sendo salvo.",
  "export-failed": "Não foi possível salvar o diagnóstico. A revisão continua disponível para nova tentativa.",
});

const SEVERITY_LABELS = Object.freeze({
  debug: "Depuração",
  info: "Informação",
  warning: "Atenção",
  error: "Erro",
  critical: "Crítico",
});

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value);
  return Object.freeze(value);
}

function requireControllerState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic review UI requires a controller state object");
  }
  if (value.schema !== DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review controller state: ${String(value.schema)}`);
  }
  if (!CONTROLLER_PHASES.has(value.phase)) {
    throw new TypeError(`Unsupported diagnostic review controller phase: ${String(value.phase)}`);
  }
  if (typeof value.exportAvailable !== "boolean") {
    throw new TypeError("Diagnostic review controller exportAvailable must be boolean");
  }
  if (typeof value.copyAvailable !== "boolean") {
    throw new TypeError("Diagnostic review controller copyAvailable must be boolean");
  }
  if (
    (value.phase === "ready" || value.phase === "copying" || value.phase === "exporting")
    && !value.document
  ) {
    throw new TypeError("Ready/copying/exporting diagnostic review state requires a prepared document");
  }
  if (value.phase === "preparing" && value.document !== null) {
    throw new TypeError("Preparing diagnostic review state cannot expose a stale document");
  }
  return value;
}

function assertDiagnosticReviewController(controller) {
  if (!controller || typeof controller !== "object") {
    throw new TypeError("Diagnostic review UI requires a controller");
  }
  if (controller.schema !== DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review controller: ${String(controller.schema)}`);
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "prepare",
    "copyPreparedSummary",
    "exportPrepared",
  ]) {
    if (typeof controller[method] !== "function") {
      throw new TypeError(`Diagnostic review controller must implement ${method}()`);
    }
  }
  requireControllerState(controller.getSnapshot());
  return controller;
}

function formatTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "horário desconhecido";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
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

function sourcePresentation(entry) {
  const label = SOURCE_LABELS[entry.id] ?? entry.id;
  const statusLabel = SOURCE_STATUS_LABELS[entry.status] ?? entry.status;
  return freeze({
    id: entry.id,
    label,
    status: entry.status,
    statusLabel,
    detail: entry.failureCode
      ? (FAILURE_LABELS[entry.failureCode] ?? entry.failureCode)
      : entry.status === "unavailable"
        ? "Esta fonte não está exposta neste modo."
        : "Incluída na revisão local.",
  });
}

function freshnessPresentation(freshness) {
  if (freshness === null || freshness === undefined) {
    return freeze({
      state: "unavailable",
      label: "Atualidade indisponível",
      detail: "Nenhuma observação de atualização foi incluída nesta revisão.",
    });
  }
  if (freshness.state === "fresh") {
    return freeze({
      state: "fresh",
      label: "Observação recente",
      detail: `Observação recebida há ${freshness.ageSeconds}s; limite desta leitura: ${freshness.maxAgeSeconds}s.`,
    });
  }
  if (freshness.state === "stale") {
    return freeze({
      state: "stale",
      label: "Observação antiga",
      detail: `A observação tem ${freshness.ageSeconds}s; o limite desta leitura é ${freshness.maxAgeSeconds}s. Isso não prova falha do supervisor.`,
    });
  }
  const reason = freshness.reason === "clock-skew"
    ? "O relógio da observação não permite determinar a atualidade com segurança."
    : freshness.reason === "invalid-checked-at"
      ? "O horário publicado pela atualização é inválido."
      : "A atualização não publicou horário suficiente para determinar atualidade.";
  return freeze({ state: "unknown", label: "Atualidade desconhecida", detail: reason });
}

function persistencePresentation(journal) {
  if (!journal) {
    return freeze({
      state: "unavailable",
      label: "Eventos indisponíveis",
      detail: "Nenhum journal diagnóstico válido foi incluído nesta revisão.",
    });
  }
  if (journal.persistenceStatus === "degraded") {
    const reason = journal.persistenceErrorCode === "load-failed"
      ? "A leitura persistente falhou; os eventos atuais podem estar apenas em memória."
      : "A gravação persistente falhou; os eventos atuais continuam disponíveis em memória nesta execução.";
    return freeze({ state: "degraded", label: "Persistência degradada", detail: reason });
  }
  if (journal.persistenceStatus === "session") {
    return freeze({
      state: "session",
      label: "Somente nesta sessão",
      detail: "Os eventos desta revisão não têm persistência durável no dispositivo.",
    });
  }
  return freeze({
    state: "device",
    label: "Persistência no dispositivo",
    detail: `Journal limitado aos ${journal.retentionLimit} eventos mais recentes.`,
  });
}

function actionPresentation(snapshot) {
  if (snapshot.phase === "preparing") {
    return freeze({ kind: "progress", text: "Preparando uma revisão local e sanitizada…" });
  }
  if (snapshot.phase === "copying") {
    return freeze({ kind: "progress", text: "Copiando resumo sanitizado…" });
  }
  if (snapshot.phase === "exporting") {
    return freeze({ kind: "progress", text: "Salvando a revisão confirmada em Downloads…" });
  }
  const last = snapshot.lastResult;
  if (!last) return null;
  if (last.action === "prepare" && last.status === "ready") {
    return freeze({
      kind: "success",
      text: "Revisão preparada localmente. Confira as fontes e os eventos antes de copiar ou salvar.",
    });
  }
  if (last.action === "copy" && last.status === "copied") {
    return freeze({ kind: "success", text: "Resumo sanitizado copiado." });
  }
  if (last.action === "export" && last.status === "saved") {
    return freeze({ kind: "success", text: "Diagnóstico salvo em Downloads." });
  }
  if (last.action === "export" && last.status === "cancelled") {
    return freeze({ kind: "neutral", text: "Salvamento cancelado. A revisão continua disponível." });
  }
  if (last.code === "review-not-prepared") {
    return freeze({
      kind: "warning",
      text: last.action === "copy"
        ? "Prepare uma revisão antes de copiar o resumo sanitizado."
        : "Prepare uma revisão antes de salvar o diagnóstico.",
    });
  }
  const text = LAST_RESULT_LABELS[last.code] ?? "A operação de diagnóstico não foi concluída.";
  return freeze({ kind: "warning", text });
}

function eventPresentation(event) {
  return freeze({
    severity: event.severity,
    severityLabel: SEVERITY_LABELS[event.severity] ?? event.severity,
    occurredAt: formatTimestamp(event.occurredAt),
    component: event.component,
    eventCode: event.eventCode,
    correlationKey: event.correlationKey,
    summary: event.message || `${event.status} · ${event.phase}`,
  });
}

export function createDiagnosticReviewPresentation(snapshotValue) {
  const snapshot = requireControllerState(snapshotValue);
  const document = snapshot.document;
  const review = document?.review ?? null;
  const report = review?.report ?? null;
  const sources = review
    ? review.manifest.sources.map(sourcePresentation)
    : [];
  const journal = report?.journal ?? null;
  const events = journal
    ? [...journal.events].reverse().map(eventPresentation)
    : [];

  const update = report?.update
    ? freeze({
      delivery: report.update.deliveryNumber
        ? deliveryLabel(report.update.deliveryNumber)
        : "Entrega não informada",
      status: updateStatusLabel(report.update.status),
      phase: readableUpdatePhase(report.update.phase),
      checkedAt: report.update.checkedAt && report.update.checkedAt !== "unknown"
        ? formatUpdateTimestamp(report.update.checkedAt)
        : "Não informado",
      lastError: report.update.lastError || "",
    })
    : null;

  const metrics = report?.metrics
    ? freeze({
      memory: `${formatBytes(report.metrics.memoryAvailableBytes)} disponível de ${formatBytes(report.metrics.memoryTotalBytes)}`,
      storage: `${formatBytes(report.metrics.userStorageFreeBytes)} livre de ${formatBytes(report.metrics.userStorageTotalBytes)}`,
      uptimeSeconds: report.metrics.uptimeSeconds,
    })
    : null;

  const history = report?.history
    ? freeze({
      releaseCount: report.history.releaseCount,
      applicationCount: report.history.applicationCount,
    })
    : null;

  return freeze({
    phase: snapshot.phase,
    exportAvailable: snapshot.exportAvailable,
    copyAvailable: snapshot.copyAvailable,
    action: actionPresentation(snapshot),
    prepare: freeze({
      label: snapshot.phase === "preparing" ? "Preparando…" : "Preparar nova revisão",
      disabled: snapshot.phase === "preparing"
        || snapshot.phase === "copying"
        || snapshot.phase === "exporting",
    }),
    copy: freeze({
      label: snapshot.phase === "copying"
        ? "Copiando…"
        : snapshot.copyAvailable
          ? "Copiar resumo sanitizado"
          : "Copiar indisponível",
      disabled: snapshot.phase !== "ready" || !snapshot.copyAvailable,
      visible: document !== null,
    }),
    export: freeze({
      label: snapshot.phase === "exporting"
        ? "Salvando…"
        : snapshot.exportAvailable
          ? "Salvar em Downloads"
          : "Salvar indisponível",
      disabled: snapshot.phase !== "ready" || !snapshot.exportAvailable,
      visible: document !== null,
    }),
    review: review
      ? freeze({
        generatedAt: formatTimestamp(review.generatedAt),
        fileName: document.fileName,
        hasFailures: review.manifest.hasFailures,
        sources: freeze(sources),
        freshness: freshnessPresentation(review.observations.updateFreshness),
        update,
        metrics,
        history,
        persistence: persistencePresentation(journal),
        eventCount: journal?.eventCount ?? null,
        events: freeze(events),
      })
      : null,
  });
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendFact(documentObject, list, label, value) {
  const item = node(documentObject, "div", "ordax-system-fact");
  item.append(
    node(documentObject, "dt", "", label),
    node(documentObject, "dd", "", value),
  );
  list.append(item);
}

function renderReview(documentObject, container, presentation) {
  const heading = node(documentObject, "div", "ordax-system-section-heading");
  const headingCopy = node(documentObject, "div");
  headingCopy.append(
    node(documentObject, "span", "ordax-system-section-kicker", "Revisão local"),
    node(documentObject, "h4", "ordax-system-section-title", "Diagnóstico revisável"),
  );
  const actions = node(documentObject, "div", "ordax-system-actions");
  const prepare = node(documentObject, "button", "ordax-system-action", presentation.prepare.label);
  prepare.type = "button";
  prepare.dataset.systemDiagnosticsPrepare = "";
  prepare.disabled = presentation.prepare.disabled;
  actions.append(prepare);
  if (presentation.copy.visible) {
    const copyButton = node(documentObject, "button", "ordax-system-action", presentation.copy.label);
    copyButton.type = "button";
    copyButton.dataset.systemDiagnosticsCopy = "";
    copyButton.disabled = presentation.copy.disabled;
    actions.append(copyButton);
  }
  if (presentation.export.visible) {
    const exportButton = node(documentObject, "button", "ordax-system-action", presentation.export.label);
    exportButton.type = "button";
    exportButton.dataset.systemDiagnosticsExport = "";
    exportButton.disabled = presentation.export.disabled;
    actions.append(exportButton);
  }
  heading.append(headingCopy, actions);
  container.append(heading);

  container.append(
    node(
      documentObject,
      "p",
      "ordax-system-section-copy",
      "A revisão é criada somente quando solicitada. Ela usa dados locais permitidos, registra fontes ausentes ou com falha e não envia conteúdo automaticamente. Copiar e salvar são ações explícitas sobre esta mesma revisão.",
    ),
  );

  if (presentation.action) {
    const status = node(
      documentObject,
      "p",
      presentation.action.kind === "warning" ? "ordax-system-warning" : "ordax-system-message",
      presentation.action.text,
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    container.append(status);
  }

  if (!presentation.review) {
    container.append(
      node(
        documentObject,
        "p",
        "ordax-system-placeholder",
        "Prepare uma revisão para consultar as fontes disponíveis, a atualidade dos sinais e os eventos locais antes de copiar ou salvar qualquer informação.",
      ),
    );
    return;
  }

  const review = presentation.review;
  if (review.hasFailures) {
    container.append(
      node(
        documentObject,
        "p",
        "ordax-system-warning",
        "Revisão parcial: uma ou mais fontes falharam. Os dados válidos continuam visíveis abaixo.",
      ),
    );
  }

  const metadata = node(documentObject, "dl", "ordax-system-facts");
  appendFact(documentObject, metadata, "Preparada em", review.generatedAt);
  appendFact(documentObject, metadata, "Arquivo", review.fileName);
  appendFact(documentObject, metadata, "Atualidade da atualização", review.freshness.label);
  appendFact(documentObject, metadata, "Persistência dos eventos", review.persistence.label);
  container.append(metadata);

  const freshnessDetail = node(
    documentObject,
    "p",
    review.freshness.state === "stale" || review.freshness.state === "unknown"
      ? "ordax-system-warning"
      : "ordax-system-section-copy",
    review.freshness.detail,
  );
  container.append(freshnessDetail);

  if (review.persistence.state === "degraded" || review.persistence.state === "session") {
    container.append(node(documentObject, "p", "ordax-system-warning", review.persistence.detail));
  } else {
    container.append(node(documentObject, "p", "ordax-system-section-copy", review.persistence.detail));
  }

  const sourceSection = node(documentObject, "div", "ordax-system-history");
  sourceSection.append(node(documentObject, "h5", "ordax-system-history-title", "Fontes desta revisão"));
  for (const source of review.sources) {
    const item = node(documentObject, "article", "ordax-system-history-item");
    item.dataset.state = source.status;
    item.append(
      node(documentObject, "strong", "", `${source.label} · ${source.statusLabel}`),
      node(documentObject, "small", "", source.detail),
    );
    sourceSection.append(item);
  }
  container.append(sourceSection);

  if (review.update) {
    const updateFacts = node(documentObject, "dl", "ordax-system-facts");
    appendFact(documentObject, updateFacts, "Entrega", review.update.delivery);
    appendFact(documentObject, updateFacts, "Estado observado", review.update.status);
    appendFact(documentObject, updateFacts, "Fase observada", review.update.phase);
    appendFact(documentObject, updateFacts, "Verificação publicada", review.update.checkedAt);
    if (review.update.lastError) appendFact(documentObject, updateFacts, "Último diagnóstico", review.update.lastError);
    container.append(updateFacts);
  }

  if (review.metrics || review.history) {
    const localFacts = node(documentObject, "dl", "ordax-system-facts");
    if (review.metrics) {
      appendFact(documentObject, localFacts, "Memória", review.metrics.memory);
      appendFact(documentObject, localFacts, "Espaço do usuário", review.metrics.storage);
    }
    if (review.history) {
      appendFact(documentObject, localFacts, "Entregas conhecidas", String(review.history.releaseCount));
      appendFact(documentObject, localFacts, "Aplicações registradas", String(review.history.applicationCount));
    }
    container.append(localFacts);
  }

  const eventSection = node(documentObject, "div", "ordax-system-history");
  eventSection.append(node(documentObject, "h5", "ordax-system-history-title", "Eventos locais incluídos"));
  if (review.eventCount === null) {
    eventSection.append(
      node(
        documentObject,
        "p",
        "ordax-system-placeholder",
        "O journal diagnóstico não foi incluído; esta ausência não é prova de que o sistema esteja sem problemas.",
      ),
    );
  } else if (review.events.length === 0) {
    eventSection.append(
      node(
        documentObject,
        "p",
        "ordax-system-placeholder",
        "Nenhum evento de atualização está retido no journal desta revisão. Isso não é um atestado geral de saúde.",
      ),
    );
  } else {
    for (const event of review.events) {
      const item = node(documentObject, "article", "ordax-system-history-item");
      item.dataset.state = event.severity;
      item.append(
        node(documentObject, "strong", "", `${event.severityLabel} · ${event.component}`),
        node(documentObject, "span", "", event.occurredAt),
        node(documentObject, "small", "", event.summary),
        node(documentObject, "small", "", `${event.eventCode} · ${event.correlationKey}`),
      );
      eventSection.append(item);
    }
  }
  container.append(eventSection);
}

export function mountSystemDiagnosticsReview(container, controllerValue) {
  if (
    !container
    || typeof container !== "object"
    || typeof container.replaceChildren !== "function"
    || typeof container.addEventListener !== "function"
    || !container.ownerDocument
  ) {
    throw new TypeError("System diagnostics review requires a DOM container");
  }
  const controller = assertDiagnosticReviewController(controllerValue);
  const documentObject = container.ownerDocument;
  let destroyed = false;

  const render = (stateValue) => {
    if (destroyed) return;
    const focused = documentObject.activeElement?.dataset?.systemDiagnosticsPrepare !== undefined
      ? "prepare"
      : documentObject.activeElement?.dataset?.systemDiagnosticsCopy !== undefined
        ? "copy"
        : documentObject.activeElement?.dataset?.systemDiagnosticsExport !== undefined
          ? "export"
          : null;
    const presentation = createDiagnosticReviewPresentation(stateValue);
    const section = node(documentObject, "section", "ordax-system-section");
    section.dataset.systemDiagnosticsReview = "";
    renderReview(documentObject, section, presentation);
    container.replaceChildren(section);

    if (focused) {
      const selector = focused === "prepare"
        ? "[data-system-diagnostics-prepare]"
        : focused === "copy"
          ? "[data-system-diagnostics-copy]"
          : "[data-system-diagnostics-export]";
      const target = section.querySelector(selector);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  };

  const click = (event) => {
    if (destroyed) return;
    const target = event.target?.closest?.("button");
    if (!target || !container.contains(target) || target.disabled) return;
    if (target.dataset.systemDiagnosticsPrepare !== undefined) {
      void controller.prepare();
    } else if (target.dataset.systemDiagnosticsCopy !== undefined) {
      void controller.copyPreparedSummary();
    } else if (target.dataset.systemDiagnosticsExport !== undefined) {
      void controller.exportPrepared();
    }
  };

  container.addEventListener("click", click);
  render(controller.getSnapshot());
  const unsubscribe = controller.subscribe(render);

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      container.removeEventListener("click", click);
      container.replaceChildren();
    },
  });
}
