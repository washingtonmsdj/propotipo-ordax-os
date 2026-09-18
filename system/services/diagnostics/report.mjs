import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import { validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";
import { validateUpdateHistorySnapshot } from "../../contracts/update-history.mjs";
import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";

export const DIAGNOSTIC_REPORT_SCHEMA = "ordax.diagnostic-report/1";

const MAX_DIAGNOSTIC_TEXT = 1000;

function validateGeneratedAt(value) {
  if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new TypeError("Diagnostic report generatedAt must be a valid timestamp string");
  }
  return value;
}

export function redactDiagnosticText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new TypeError("Diagnostic report text must be a string");
  }

  return value
    .slice(0, MAX_DIAGNOSTIC_TEXT)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|passwd|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, "[user-path]")
    .replace(/\/home\/[^/\s]+/g, "/home/[user]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
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

export function createDiagnosticReport({
  generatedAt = new Date().toISOString(),
  surface,
  update = null,
  metrics = null,
  history = null,
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
