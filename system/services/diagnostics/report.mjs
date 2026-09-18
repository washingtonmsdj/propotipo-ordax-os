import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import { validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";
import { validateUpdateHistorySnapshot } from "../../contracts/update-history.mjs";
import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { redactDiagnosticText } from "./redaction.mjs";
import { validateDiagnosticJournalRuntimeSnapshot } from "./runtime.mjs";

export const DIAGNOSTIC_REPORT_SCHEMA = "ordax.diagnostic-report/2";

function validateGeneratedAt(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 64
    || Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError("Diagnostic report generatedAt must be a bounded valid timestamp string");
  }
  return value;
}

function summarizeUpdate(value) {
  if (value === null || value === undefined) return null;
  const snapshot = validateUpdateStatusSnapshot(value);
  return Object.freeze({
    deliveryNumber: snapshot.deliveryNumber,
    sourceSha: snapshot.sourceSha,
    runtimeSurfaceSha: snapshot.runtimeSurfaceSha,
    targetSha: snapshot.targetSha || null,
    status: snapshot.status,
    phase: snapshot.phase,
    applyMode: snapshot.applyMode,
    bootRefreshRequired: snapshot.bootRefreshRequired,
    checkedAt: snapshot.checkedAt,
    lastAppliedSha: snapshot.lastAppliedSha || null,
    lastAppliedAt: snapshot.lastAppliedAt,
    rejectedSha: snapshot.rejectedSha || null,
    lastError: redactDiagnosticText(snapshot.lastError),
    healthTokenPresent: snapshot.healthToken.length > 0,
  });
}

function summarizeMetrics(value) {
  if (value === null || value === undefined) return null;
  const snapshot = validateSystemMetricsSnapshot(value);
  return Object.freeze({ ...snapshot });
}

function summarizeHistory(value) {
  if (value === null || value === undefined) return null;
  const snapshot = validateUpdateHistorySnapshot(value);
  return Object.freeze({
    releaseCount: snapshot.releases.length,
    applicationCount: snapshot.applications.length,
    recentReleases: Object.freeze(
      snapshot.releases.slice(0, 12).map((entry) =>
        Object.freeze({
          deliveryNumber: entry.deliveryNumber,
          sourceSha: entry.sourceSha,
          releasedAt: entry.releasedAt,
          title: redactDiagnosticText(entry.title),
        }),
      ),
    ),
    recentApplications: Object.freeze(
      snapshot.applications.slice(0, 20).map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function summarizeJournal(value) {
  if (value === null || value === undefined) return null;
  const snapshot = validateDiagnosticJournalRuntimeSnapshot(value);
  return Object.freeze({
    eventCount: snapshot.events.length,
    retentionLimit: snapshot.retentionLimit,
    configuredStoreScope: snapshot.configuredStoreScope,
    persistenceStatus: snapshot.persistenceStatus,
    persistenceErrorCode: snapshot.persistenceErrorCode,
    events: Object.freeze(
      snapshot.events.map((entry) => Object.freeze({
        $schema: entry.$schema,
        eventCode: entry.eventCode,
        component: entry.component,
        severity: entry.severity,
        occurredAt: entry.occurredAt,
        correlationKey: entry.correlationKey,
        deliveryNumber: entry.deliveryNumber,
        sourceSha: entry.sourceSha,
        targetSha: entry.targetSha,
        rejectedSha: entry.rejectedSha,
        status: entry.status,
        phase: entry.phase,
        message: redactDiagnosticText(entry.message),
      })),
    ),
  });
}

export function createDiagnosticReport({
  generatedAt = new Date().toISOString(),
  surface,
  update = null,
  metrics = null,
  history = null,
  journal = null,
}) {
  const surfaceSnapshot = validateSurfaceSnapshot(surface);

  return Object.freeze({
    schema: DIAGNOSTIC_REPORT_SCHEMA,
    generatedAt: validateGeneratedAt(generatedAt),
    scope: "local-reviewable",
    surface: Object.freeze({
      connectivity: surfaceSnapshot.connectivity,
      capabilityIds: Object.freeze([...surfaceSnapshot.capabilityIds].sort()),
    }),
    update: summarizeUpdate(update),
    metrics: summarizeMetrics(metrics),
    history: summarizeHistory(history),
    journal: summarizeJournal(journal),
  });
}

function reportFileStamp(generatedAt) {
  return generatedAt
    .replace(/[^0-9A-Za-z-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createDiagnosticReportDocument(input) {
  const report = createDiagnosticReport(input);
  return Object.freeze({
    report,
    fileName: `ordax-diagnostico-${reportFileStamp(report.generatedAt)}.json`,
    mediaType: "application/json",
    text: `${JSON.stringify(report, null, 2)}\n`,
  });
}
