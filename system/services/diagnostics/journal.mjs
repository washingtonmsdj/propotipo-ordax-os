import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { redactDiagnosticText } from "./report.mjs";

export const DIAGNOSTIC_EVENT_SCHEMA = "ordax.diagnostic-event/1";
export const DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT = 100;
export const MAX_DIAGNOSTIC_JOURNAL_LIMIT = 500;

function requireTimestamp(value, field) {
  if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`Diagnostic event ${field} must be a valid timestamp string`);
  }
  return value;
}

function requireLimit(value) {
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

function updateIncidentCorrelation(snapshot) {
  if (snapshot.attemptId) return `update:attempt:${snapshot.attemptId}`;
  if (snapshot.rejectedSha) return `update:rejected:${snapshot.rejectedSha}`;
  if (snapshot.targetSha) return `update:target:${snapshot.targetSha}`;
  return `update:source:${snapshot.sourceSha}`;
}

export function createUpdateDiagnosticEvent({
  occurredAt = new Date().toISOString(),
  update,
}) {
  const snapshot = validateUpdateStatusSnapshot(update);
  return Object.freeze({
    $schema: DIAGNOSTIC_EVENT_SCHEMA,
    occurredAt: requireTimestamp(occurredAt, "occurredAt"),
    kind: "update-state",
    correlationKey: updateIncidentCorrelation(snapshot),
    deliveryNumber: snapshot.deliveryNumber,
    sourceSha: snapshot.sourceSha,
    targetSha: snapshot.targetSha || null,
    rejectedSha: snapshot.rejectedSha || null,
    status: snapshot.status,
    phase: snapshot.phase,
    message: redactDiagnosticText(snapshot.lastError),
  });
}

export function validateDiagnosticEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic event must be an object");
  }
  if (value.$schema !== DIAGNOSTIC_EVENT_SCHEMA || value.kind !== "update-state") {
    throw new TypeError("Unsupported diagnostic event schema or kind");
  }
  if (!Number.isSafeInteger(value.deliveryNumber) || value.deliveryNumber < 0) {
    throw new TypeError("Diagnostic event deliveryNumber must be a non-negative safe integer");
  }
  return Object.freeze({
    $schema: DIAGNOSTIC_EVENT_SCHEMA,
    occurredAt: requireTimestamp(value.occurredAt, "occurredAt"),
    kind: "update-state",
    correlationKey: boundedString(value.correlationKey, "correlationKey"),
    deliveryNumber: value.deliveryNumber,
    sourceSha: boundedString(value.sourceSha, "sourceSha", 64),
    targetSha: value.targetSha === null ? null : boundedString(value.targetSha, "targetSha", 64),
    rejectedSha:
      value.rejectedSha === null ? null : boundedString(value.rejectedSha, "rejectedSha", 64),
    status: boundedString(value.status, "status", 64),
    phase: boundedString(value.phase, "phase", 64),
    message: redactDiagnosticText(value.message ?? ""),
  });
}

export function rotateDiagnosticEvents(
  values,
  limit = DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT,
) {
  if (!Array.isArray(values)) {
    throw new TypeError("Diagnostic journal events must be an array");
  }
  const boundedLimit = requireLimit(limit);
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
