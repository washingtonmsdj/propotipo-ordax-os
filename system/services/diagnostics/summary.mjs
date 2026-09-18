import {
  DIAGNOSTIC_SUMMARY_SCHEMA,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";
import { DIAGNOSTIC_REPORT_SCHEMA } from "./report.mjs";
import { DIAGNOSTIC_REVIEW_SCHEMA } from "./review.mjs";
import { redactDiagnosticText } from "./redaction.mjs";

const SOURCE_IDS = Object.freeze(["surface", "update", "metrics", "history", "journal"]);
const SOURCE_ID_SET = new Set(SOURCE_IDS);
const SOURCE_STATUS_SET = new Set(["included", "unavailable", "failed"]);
const SOURCE_LABELS = Object.freeze({
  surface: "Surface",
  update: "Atualização",
  metrics: "Métricas",
  history: "Histórico",
  journal: "Registro diagnóstico",
});
const SOURCE_STATUS_LABELS = Object.freeze({
  included: "incluída",
  unavailable: "indisponível",
  failed: "falha na leitura",
});
const FRESHNESS_STATES = new Set(["fresh", "stale", "unknown"]);
const MAX_SUMMARY_EVENTS = 10;

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function safeText(value) {
  return redactDiagnosticText(value === null || value === undefined ? "" : String(value));
}

function safeCode(value, label, { allowEmpty = true } = {}) {
  if (value === "" && allowEmpty) return "";
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) {
    throw new TypeError(`${label} must be a bounded stable code`);
  }
  return value;
}

function safeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function safeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function formatBytes(value) {
  const bytes = safeNumber(value, "Diagnostic byte count");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const precision = unit >= 3 && amount < 10 ? 1 : 0;
  return `${amount.toFixed(precision)} ${units[unit]}`;
}

function validateReviewDocument(document) {
  const root = asObject(document, "Diagnostic review document");
  const review = asObject(root.review, "Diagnostic review");
  if (review.schema !== DIAGNOSTIC_REVIEW_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review schema: ${String(review.schema)}`);
  }
  if (
    typeof review.generatedAt !== "string"
    || review.generatedAt.length === 0
    || review.generatedAt.length > 64
    || Number.isNaN(Date.parse(review.generatedAt))
  ) {
    throw new TypeError("Diagnostic review generatedAt must be a bounded valid timestamp");
  }
  if (review.scope !== "explicit-local-review") {
    throw new TypeError("Diagnostic review scope must be explicit-local-review");
  }

  const manifest = asObject(review.manifest, "Diagnostic review manifest");
  if (!Array.isArray(manifest.sources) || manifest.sources.length !== SOURCE_IDS.length) {
    throw new TypeError("Diagnostic review source manifest must contain every canonical source");
  }
  const sourceIds = new Set();
  for (const entryValue of manifest.sources) {
    const entry = asObject(entryValue, "Diagnostic review source");
    if (!SOURCE_ID_SET.has(entry.id) || sourceIds.has(entry.id)) {
      throw new TypeError("Diagnostic review source manifest contains an invalid or duplicate source");
    }
    if (!SOURCE_STATUS_SET.has(entry.status)) {
      throw new TypeError("Diagnostic review source has an unsupported status");
    }
    const failureCode = safeCode(entry.failureCode ?? "", "Diagnostic review source failureCode");
    if ((entry.status === "failed") !== (failureCode.length > 0)) {
      throw new TypeError("Diagnostic review source failureCode must match failed status");
    }
    sourceIds.add(entry.id);
  }

  const observations = asObject(review.observations, "Diagnostic review observations");
  if (observations.updateFreshness !== null) {
    const freshness = asObject(observations.updateFreshness, "Diagnostic update freshness");
    if (!FRESHNESS_STATES.has(freshness.state)) {
      throw new TypeError("Diagnostic update freshness has an unsupported state");
    }
  }

  const report = asObject(review.report, "Diagnostic report");
  if (report.schema !== DIAGNOSTIC_REPORT_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic report schema: ${String(report.schema)}`);
  }
  if (report.generatedAt !== review.generatedAt) {
    throw new TypeError("Diagnostic review and report timestamps must match");
  }

  return review;
}

function sourceLines(review) {
  const byId = new Map(review.manifest.sources.map((entry) => [entry.id, entry]));
  return SOURCE_IDS.map((sourceId) => {
    const entry = byId.get(sourceId);
    const suffix = entry.failureCode ? ` (${safeCode(entry.failureCode, "failureCode")})` : "";
    return `- ${SOURCE_LABELS[sourceId]}: ${SOURCE_STATUS_LABELS[entry.status]}${suffix}`;
  });
}

function updateLines(review) {
  const report = review.report;
  if (report.update === null) {
    return ["Atualização: indisponível nesta revisão."];
  }

  const update = asObject(report.update, "Diagnostic report update");
  const lines = [
    `Atualização: entrega ${safeText(update.deliveryNumber)} · estado ${safeText(update.status)} · fase ${safeText(update.phase)} · aplicação ${safeText(update.applyMode)}`,
    `SHA observado: ${safeText(update.sourceSha) || "não informado"}`,
  ];
  if (update.runtimeSurfaceSha) lines.push(`Surface em execução: ${safeText(update.runtimeSurfaceSha)}`);
  if (update.targetSha) lines.push(`SHA alvo: ${safeText(update.targetSha)}`);
  if (update.checkedAt) lines.push(`Observação do atualizador: ${safeText(update.checkedAt)}`);
  if (update.lastError) lines.push(`Último diagnóstico do atualizador: ${safeText(update.lastError)}`);

  const freshness = review.observations.updateFreshness;
  if (freshness === null) {
    lines.push("Atualidade da observação: indisponível.");
  } else {
    const state = freshness.state;
    if (state === "fresh") {
      lines.push("Atualidade da observação: recente.");
    } else if (state === "stale") {
      const age = Number.isFinite(freshness.ageSeconds) && freshness.ageSeconds >= 0
        ? ` (${Math.round(freshness.ageSeconds)}s de idade)`
        : "";
      lines.push(`Atualidade da observação: antiga${age}. Isso não prova falha do supervisor.`);
    } else {
      lines.push(`Atualidade da observação: desconhecida${freshness.reason ? ` (${safeText(freshness.reason)})` : ""}.`);
    }
  }
  return lines;
}

function metricLines(report) {
  if (report.metrics === null) return ["Métricas: indisponíveis nesta revisão."];
  const metrics = asObject(report.metrics, "Diagnostic report metrics");
  const memoryTotal = safeNumber(metrics.memoryTotalBytes, "memoryTotalBytes");
  const memoryAvailable = safeNumber(metrics.memoryAvailableBytes, "memoryAvailableBytes");
  const storageTotal = safeNumber(metrics.userStorageTotalBytes, "userStorageTotalBytes");
  const storageFree = safeNumber(metrics.userStorageFreeBytes, "userStorageFreeBytes");
  const uptime = safeNumber(metrics.uptimeSeconds, "uptimeSeconds");
  if (memoryAvailable > memoryTotal || storageFree > storageTotal) {
    throw new TypeError("Diagnostic metrics contain impossible available/free values");
  }
  return [
    `Tempo ligado: ${Math.round(uptime)}s`,
    `Memória: ${formatBytes(memoryTotal - memoryAvailable)} em uso de ${formatBytes(memoryTotal)}`,
    `Espaço do usuário: ${formatBytes(storageFree)} livre de ${formatBytes(storageTotal)}`,
  ];
}

function historyLines(report) {
  if (report.history === null) return ["Histórico: indisponível nesta revisão."];
  const history = asObject(report.history, "Diagnostic report history");
  return [
    `Histórico: ${safeCount(history.releaseCount, "releaseCount")} entregas · ${safeCount(history.applicationCount, "applicationCount")} aplicações locais.`,
  ];
}

function journalLines(report) {
  if (report.journal === null) {
    return [
      "Registro diagnóstico: indisponível nesta revisão.",
      "A ausência do registro não comprova ausência de problemas.",
    ];
  }

  const journal = asObject(report.journal, "Diagnostic report journal");
  const eventCount = safeCount(journal.eventCount, "eventCount");
  const retentionLimit = safeCount(journal.retentionLimit, "retentionLimit");
  const scope = safeCode(journal.configuredStoreScope, "configuredStoreScope", { allowEmpty: false });
  const persistence = safeCode(journal.persistenceStatus, "persistenceStatus", { allowEmpty: false });
  const errorCode = safeCode(journal.persistenceErrorCode ?? "", "persistenceErrorCode");
  if (!Array.isArray(journal.events) || journal.events.length > retentionLimit) {
    throw new TypeError("Diagnostic journal events must be bounded by retentionLimit");
  }

  const lines = [
    `Registro diagnóstico: ${eventCount} eventos retidos de até ${retentionLimit}.`,
    `Persistência: ${persistence} · escopo configurado ${scope}${errorCode ? ` · ${errorCode}` : ""}.`,
  ];
  if (eventCount === 0) {
    lines.push("Nenhum evento está retido nesta revisão; isso não é um atestado geral de saúde.");
    return lines;
  }

  lines.push(`Eventos recentes (até ${MAX_SUMMARY_EVENTS}):`);
  for (const eventValue of journal.events.slice(-MAX_SUMMARY_EVENTS)) {
    const event = asObject(eventValue, "Diagnostic journal event");
    const occurredAt = safeText(event.occurredAt) || "horário desconhecido";
    const severity = safeText(event.severity) || "unknown";
    const component = safeText(event.component) || "unknown";
    const eventCode = safeText(event.eventCode) || "unknown";
    const message = safeText(event.message);
    const correlation = safeText(event.correlationKey);
    lines.push(
      `- ${occurredAt} · ${severity} · ${component} · ${eventCode}${message ? ` · ${message}` : ""}${correlation ? ` · correlação ${correlation}` : ""}`,
    );
  }
  return lines;
}

export function createDiagnosticReviewSummary(document) {
  const review = validateReviewDocument(document);
  const report = review.report;
  const surface = asObject(report.surface, "Diagnostic report surface");
  if (!Array.isArray(surface.capabilityIds) || surface.capabilityIds.length > 128) {
    throw new TypeError("Diagnostic Surface capabilityIds must be a bounded array");
  }

  const lines = [
    "OrdaX — resumo sanitizado de diagnóstico",
    `Gerado: ${review.generatedAt}`,
    "Escopo: revisão local explícita",
    "",
    "Fontes da revisão:",
    ...sourceLines(review),
    "",
    `Conectividade observada: ${safeText(surface.connectivity) || "desconhecida"}`,
    `Capacidades declaradas: ${surface.capabilityIds.length === 0 ? "nenhuma" : surface.capabilityIds.map(safeText).join(", ")}`,
    "",
    ...updateLines(review),
    "",
    ...metricLines(report),
    "",
    ...historyLines(report),
    "",
    ...journalLines(report),
    "",
    "Resumo gerado somente a partir da revisão estruturada e sanitizada. O JSON bruto do documento não é usado como fonte desta cópia.",
  ];

  return validateDiagnosticSummary({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: "text/plain;charset=utf-8",
    text: `${lines.join("\n")}\n`,
  });
}
