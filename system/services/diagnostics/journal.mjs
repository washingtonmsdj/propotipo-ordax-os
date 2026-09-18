import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { redactDiagnosticText } from "./redaction.mjs";

export const DIAGNOSTIC_EVENT_SCHEMA = "ordax.diagnostic-event/2";
export const UPDATE_STATE_EVENT_CODE = "system.update.state";
export const UPDATE_COMPONENT = "update";
export const DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT = 100;
export const MAX_DIAGNOSTIC_JOURNAL_LIMIT = 500;

const DIAGNOSTIC_SEVERITIES = new Set([
  "debug",
  "info",
  "warning",
  "error",
  "critical",
]);

const UPDATE_ERROR_STATUSES = new Set([
  "network-error",
  "remote-error",
  "pull-error",
]);

const UPDATE_WARNING_STATUSES = new Set([
  "rolled-back",
  "rejected",
  "unavailable",
]);

function requireTimestamp(value, field) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 64
    || Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`Diagnostic event ${field} must be a bounded valid timestamp string`);
  }
  return value;
}

export function validateDiagnosticJournalLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DIAGNOSTIC_JOURNAL_LIMIT) {
    throw new TypeError(
      `Diagnostic journal limit must be an integer between 1 and ${MAX_DIAGNOSTIC_JOURNAL_LIMIT}`,
    );
  }
  return value;
}

function boundedString(value, field, maximum = 240) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`Diagnostic event ${field} must be a bounded non-empty string`);
  }
  return value;
}

function nullableBoundedString(value, field, maximum = 240) {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, field, maximum);
}

function updateIncidentCorrelation(snapshot) {
  if (snapshot.attemptId) return `update:attempt:${snapshot.attemptId}`;
  if (snapshot.rejectedSha) return `update:rejected:${snapshot.rejectedSha}`;
  if (snapshot.targetSha) return `update:target:${snapshot.targetSha}`;
  return `update:source:${snapshot.sourceSha}`;
}

function updateSeverity(snapshot) {
  if (snapshot.phase === "error" || UPDATE_ERROR_STATUSES.has(snapshot.status)) {
    return "error";
  }
  if (
    snapshot.phase === "blocked"
    || snapshot.phase === "rollback"
    || snapshot.bootRefreshRequired
    || UPDATE_WARNING_STATUSES.has(snapshot.status)
  ) {
    return "warning";
  }
  return "info";
}

export function validateDiagnosticEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic event must be an object");
  }
  if (value.$schema !== DIAGNOSTIC_EVENT_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic event schema: ${String(value.$schema)}`);
  }
  if (value.eventCode !== UPDATE_STATE_EVENT_CODE) {
    throw new TypeError(`Unsupported diagnostic event code: ${String(value.eventCode)}`);
  }
  if (value.component !== UPDATE_COMPONENT) {
    throw new TypeError(`Unsupported diagnostic component: ${String(value.component)}`);
  }
  if (!DIAGNOSTIC_SEVERITIES.has(value.severity)) {
    throw new TypeError(`Unsupported diagnostic severity: ${String(value.severity)}`);
  }
  if (!Number.isSafeInteger(value.deliveryNumber) || value.deliveryNumber < 0) {
    throw new TypeError("Diagnostic event deliveryNumber must be a non-negative safe integer");
  }

  return Object.freeze({
    $schema: DIAGNOSTIC_EVENT_SCHEMA,
    eventCode: UPDATE_STATE_EVENT_CODE,
    component: UPDATE_COMPONENT,
    severity: value.severity,
    occurredAt: requireTimestamp(value.occurredAt, "occurredAt"),
    correlationKey: boundedString(value.correlationKey, "correlationKey"),
    deliveryNumber: value.deliveryNumber,
    sourceSha: boundedString(value.sourceSha, "sourceSha", 64),
    targetSha: nullableBoundedString(value.targetSha, "targetSha", 64),
    rejectedSha: nullableBoundedString(value.rejectedSha, "rejectedSha", 64),
    status: boundedString(value.status, "status", 64),
    phase: boundedString(value.phase, "phase", 64),
    message: redactDiagnosticText(value.message ?? ""),
  });
}

export function createUpdateDiagnosticEvent({
  occurredAt = new Date().toISOString(),
  update,
}) {
  const snapshot = validateUpdateStatusSnapshot(update);
  return validateDiagnosticEvent({
    $schema: DIAGNOSTIC_EVENT_SCHEMA,
    eventCode: UPDATE_STATE_EVENT_CODE,
    component: UPDATE_COMPONENT,
    severity: updateSeverity(snapshot),
    occurredAt,
    correlationKey: updateIncidentCorrelation(snapshot),
    deliveryNumber: snapshot.deliveryNumber,
    sourceSha: snapshot.sourceSha,
    targetSha: snapshot.targetSha || null,
    rejectedSha: snapshot.rejectedSha || null,
    status: snapshot.status,
    phase: snapshot.phase,
    message: snapshot.lastError,
  });
}

export function rotateDiagnosticEvents(
  values,
  limit = DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT,
) {
  if (!Array.isArray(values)) {
    throw new TypeError("Diagnostic journal events must be an array");
  }
  const boundedLimit = validateDiagnosticJournalLimit(limit);
  const validated = values.map(validateDiagnosticEvent);
  return Object.freeze(validated.slice(-boundedLimit));
}

export function appendDiagnosticEvent(
  values,
  event,
  limit = DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT,
) {
  if (!Array.isArray(values)) {
    throw new TypeError("Diagnostic journal events must be an array");
  }
  return rotateDiagnosticEvents([...values, validateDiagnosticEvent(event)], limit);
}
