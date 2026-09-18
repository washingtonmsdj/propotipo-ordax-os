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
import { evaluateUpdateStateFreshness } from "../update/freshness.mjs";
import { createDiagnosticReport } from "./report.mjs";
import {
  DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA,
  validateDiagnosticJournalRuntimeSnapshot,
} from "./runtime.mjs";

export const DIAGNOSTIC_REVIEW_SCHEMA = "ordax.diagnostic-review/1";

const SOURCE_IDS = Object.freeze([
  "surface",
  "update",
  "metrics",
  "history",
  "journal",
]);

const FALLBACK_SURFACE = Object.freeze({
  connectivity: "unknown",
  capabilityIds: Object.freeze([]),
});

function sourceResult(id, status, failureCode = "") {
  return Object.freeze({ id, status, failureCode });
}

function assertJournalRuntime(runtime) {
  if (
    !runtime
    || typeof runtime !== "object"
    || runtime.schema !== DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA
    || typeof runtime.getSnapshot !== "function"
  ) {
    throw new TypeError("A compatible diagnostic journal runtime is required");
  }
  return runtime;
}

function fileStamp(generatedAt) {
  return generatedAt
    .replace(/[^0-9A-Za-z-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function freezeManifest(entries) {
  const includedSourceIds = entries
    .filter((entry) => entry.status === "included")
    .map((entry) => entry.id);
  const unavailableSourceIds = entries
    .filter((entry) => entry.status === "unavailable")
    .map((entry) => entry.id);
  const failedSourceIds = entries
    .filter((entry) => entry.status === "failed")
    .map((entry) => entry.id);

  return Object.freeze({
    sources: Object.freeze(entries),
    includedSourceIds: Object.freeze(includedSourceIds),
    unavailableSourceIds: Object.freeze(unavailableSourceIds),
    failedSourceIds: Object.freeze(failedSourceIds),
    hasFailures: failedSourceIds.length > 0,
  });
}

export async function createDiagnosticReview({
  generatedAt = new Date().toISOString(),
  host,
  updateStatus = null,
  systemMetrics = null,
  updateHistory = null,
  diagnosticJournal = null,
  updateMaxAgeSeconds = undefined,
}) {
  let surface = FALLBACK_SURFACE;
  let update = null;
  let metrics = null;
  let history = null;
  let journal = null;
  const manifestEntries = [];

  try {
    const hostPort = assertSurfaceHost(host);
    surface = validateSurfaceSnapshot(hostPort.getSnapshot());
    manifestEntries.push(sourceResult("surface", "included"));
  } catch {
    manifestEntries.push(sourceResult("surface", "failed", "surface-read-failed"));
  }

  if (updateStatus === null) {
    manifestEntries.push(sourceResult("update", "unavailable"));
  } else {
    try {
      const updatePort = assertUpdateStatusPort(updateStatus);
      const value = updatePort.getSnapshot();
      if (value === null) {
        manifestEntries.push(sourceResult("update", "unavailable"));
      } else {
        update = validateUpdateStatusSnapshot(value);
        manifestEntries.push(sourceResult("update", "included"));
      }
    } catch {
      manifestEntries.push(sourceResult("update", "failed", "update-read-failed"));
    }
  }

  if (systemMetrics === null) {
    manifestEntries.push(sourceResult("metrics", "unavailable"));
  } else {
    try {
      const metricsPort = assertSystemMetricsPort(systemMetrics);
      metrics = validateSystemMetricsSnapshot(await metricsPort.read());
      manifestEntries.push(sourceResult("metrics", "included"));
    } catch {
      manifestEntries.push(sourceResult("metrics", "failed", "metrics-read-failed"));
    }
  }

  if (updateHistory === null) {
    manifestEntries.push(sourceResult("history", "unavailable"));
  } else {
    try {
      const historyPort = assertUpdateHistoryPort(updateHistory);
      history = validateUpdateHistorySnapshot(await historyPort.list());
      manifestEntries.push(sourceResult("history", "included"));
    } catch {
      manifestEntries.push(sourceResult("history", "failed", "history-read-failed"));
    }
  }

  if (diagnosticJournal === null) {
    manifestEntries.push(sourceResult("journal", "unavailable"));
  } else {
    try {
      const runtime = assertJournalRuntime(diagnosticJournal);
      journal = validateDiagnosticJournalRuntimeSnapshot(runtime.getSnapshot());
      manifestEntries.push(sourceResult("journal", "included"));
    } catch {
      manifestEntries.push(sourceResult("journal", "failed", "journal-read-failed"));
    }
  }

  if (manifestEntries.length !== SOURCE_IDS.length) {
    throw new Error("Diagnostic review source manifest is incomplete");
  }

  const report = createDiagnosticReport({
    generatedAt,
    surface,
    update,
    metrics,
    history,
    journal,
  });

  const freshness = update === null
    ? null
    : evaluateUpdateStateFreshness(update, {
      nowMs: Date.parse(report.generatedAt),
      ...(updateMaxAgeSeconds === undefined
        ? {}
        : { maxAgeSeconds: updateMaxAgeSeconds }),
    });

  return Object.freeze({
    schema: DIAGNOSTIC_REVIEW_SCHEMA,
    generatedAt: report.generatedAt,
    scope: "explicit-local-review",
    manifest: freezeManifest(manifestEntries),
    observations: Object.freeze({
      updateFreshness: freshness,
    }),
    report,
  });
}

export async function createDiagnosticReviewDocument(input) {
  const review = await createDiagnosticReview(input);
  return Object.freeze({
    review,
    fileName: `ordax-revisao-diagnostico-${fileStamp(review.generatedAt)}.json`,
    mediaType: "application/json",
    text: `${JSON.stringify(review, null, 2)}\n`,
  });
}
