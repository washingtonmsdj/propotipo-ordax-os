import {
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";
import { DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA } from "./runtime.mjs";

function assertDiagnosticJournalRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new TypeError("Diagnostic recorder requires a journal runtime");
  }
  if (runtime.schema !== DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic journal runtime: ${String(runtime.schema)}`);
  }
  if (typeof runtime.appendUpdate !== "function") {
    throw new TypeError("Diagnostic journal runtime must implement appendUpdate()");
  }
  return runtime;
}

function semanticFingerprint(value) {
  const snapshot = validateUpdateStatusSnapshot(value);
  return JSON.stringify([
    snapshot.sourceSha,
    snapshot.deliveryNumber,
    snapshot.runtimeSurfaceSha,
    snapshot.targetSha,
    snapshot.status,
    snapshot.phase,
    snapshot.applyMode,
    snapshot.attemptId,
    snapshot.bootRefreshRequired,
    snapshot.lastAppliedSha,
    snapshot.lastAppliedAt,
    snapshot.lastApplyDurationSeconds,
    snapshot.lastStageDurationSeconds,
    snapshot.rejectedSha,
    snapshot.lastError,
  ]);
}

function requireClock(value) {
  if (typeof value !== "function") {
    throw new TypeError("Diagnostic recorder clock must be a function");
  }
  return value;
}

export function createUpdateDiagnosticRecorder(
  updateStatusPort,
  journalRuntime,
  { now = () => new Date().toISOString() } = {},
) {
  const updates = assertUpdateStatusPort(updateStatusPort);
  const journal = assertDiagnosticJournalRuntime(journalRuntime);
  const clock = requireClock(now);
  let lastFingerprint = null;
  let disposed = false;
  const pendingAppends = new Set();

  const observe = (value) => {
    if (disposed || value === null || value === undefined) return;
    const snapshot = validateUpdateStatusSnapshot(value);
    const fingerprint = semanticFingerprint(snapshot);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;

    const append = journal.appendUpdate(snapshot, clock());
    pendingAppends.add(append);
    void append.finally(() => pendingAppends.delete(append)).catch(() => undefined);
  };

  observe(updates.getSnapshot());
  const unsubscribe = updates.subscribe(observe);

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
    async flush() {
      const pending = [...pendingAppends];
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    },
  });
}
