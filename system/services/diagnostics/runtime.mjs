import {
  assertDiagnosticJournalStore,
  validateDiagnosticJournalPayload,
} from "../../contracts/diagnostic-journal-store.mjs";
import {
  DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT,
  appendDiagnosticEvent,
  createUpdateDiagnosticEvent,
  rotateDiagnosticEvents,
  validateDiagnosticEvent,
  validateDiagnosticJournalLimit,
} from "./journal.mjs";

export const DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA = "ordax.diagnostic-journal-runtime/1";
export const DIAGNOSTIC_JOURNAL_STATE_SCHEMA = "ordax.diagnostic-journal-state/1";

const STORE_SCOPES = new Set(["device", "session"]);
const PERSISTENCE_STATUSES = new Set(["device", "session", "degraded"]);
const PERSISTENCE_ERROR_CODES = new Set(["", "load-failed", "save-failed"]);

function requireStoreScope(value) {
  if (!STORE_SCOPES.has(value)) {
    throw new TypeError("Diagnostic journal configuredStoreScope must be device or session");
  }
  return value;
}

function requirePersistenceStatus(value) {
  if (!PERSISTENCE_STATUSES.has(value)) {
    throw new TypeError("Diagnostic journal persistenceStatus is invalid");
  }
  return value;
}

function requirePersistenceErrorCode(value) {
  if (!PERSISTENCE_ERROR_CODES.has(value)) {
    throw new TypeError("Diagnostic journal persistenceErrorCode is invalid");
  }
  return value;
}

export function validateDiagnosticJournalRuntimeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic journal runtime snapshot must be an object");
  }

  const retentionLimit = validateDiagnosticJournalLimit(value.retentionLimit);
  if (!Array.isArray(value.events)) {
    throw new TypeError("Diagnostic journal runtime events must be an array");
  }
  if (value.events.length > retentionLimit) {
    throw new TypeError("Diagnostic journal runtime exceeds its retention limit");
  }

  const configuredStoreScope = requireStoreScope(value.configuredStoreScope);
  const persistenceStatus = requirePersistenceStatus(value.persistenceStatus);
  const persistenceErrorCode = requirePersistenceErrorCode(value.persistenceErrorCode);

  if (persistenceStatus === "degraded") {
    if (persistenceErrorCode === "") {
      throw new TypeError("Degraded diagnostic persistence requires an error code");
    }
  } else {
    if (persistenceStatus !== configuredStoreScope) {
      throw new TypeError("Healthy diagnostic persistence must match configured store scope");
    }
    if (persistenceErrorCode !== "") {
      throw new TypeError("Healthy diagnostic persistence cannot expose an error code");
    }
  }

  return Object.freeze({
    events: Object.freeze(value.events.map(validateDiagnosticEvent)),
    retentionLimit,
    configuredStoreScope,
    persistenceStatus,
    persistenceErrorCode,
  });
}

function deserializeState(payload, retentionLimit) {
  const validatedPayload = validateDiagnosticJournalPayload(payload);
  if (validatedPayload === null) return Object.freeze([]);

  const value = JSON.parse(validatedPayload);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic journal state must be an object");
  }
  if (value.$schema !== DIAGNOSTIC_JOURNAL_STATE_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic journal state schema: ${String(value.$schema)}`);
  }
  if (!Array.isArray(value.events)) {
    throw new TypeError("Diagnostic journal state events must be an array");
  }
  return rotateDiagnosticEvents(value.events, retentionLimit);
}

function serializeState(events) {
  return validateDiagnosticJournalPayload(JSON.stringify({
    $schema: DIAGNOSTIC_JOURNAL_STATE_SCHEMA,
    events,
  }));
}

export async function createDiagnosticJournalRuntime({
  store = null,
  retentionLimit = DEFAULT_DIAGNOSTIC_JOURNAL_LIMIT,
} = {}) {
  const limit = validateDiagnosticJournalLimit(retentionLimit);
  const journalStore = store === null ? null : assertDiagnosticJournalStore(store);

  let events = Object.freeze([]);
  let persistenceStatus = journalStore?.scope ?? "session";
  let persistenceErrorCode = "";
  let persistenceQueue = Promise.resolve(true);

  if (journalStore) {
    try {
      events = deserializeState(await journalStore.load(), limit);
    } catch {
      events = Object.freeze([]);
      persistenceStatus = "degraded";
      persistenceErrorCode = "load-failed";
    }
  }

  const persist = () => {
    if (!journalStore) return Promise.resolve(false);

    let payload;
    try {
      payload = serializeState(events);
    } catch {
      persistenceStatus = "degraded";
      persistenceErrorCode = "save-failed";
      return Promise.resolve(false);
    }

    const write = async () => {
      try {
        const result = await journalStore.save(payload);
        if (result === false) {
          throw new Error("Diagnostic journal store rejected persistence");
        }
        persistenceStatus = journalStore.scope;
        persistenceErrorCode = "";
        return true;
      } catch {
        persistenceStatus = "degraded";
        persistenceErrorCode = "save-failed";
        return false;
      }
    };

    persistenceQueue = persistenceQueue.then(write, write);
    return persistenceQueue;
  };

  const snapshot = () => validateDiagnosticJournalRuntimeSnapshot({
    events,
    retentionLimit: limit,
    configuredStoreScope: journalStore?.scope ?? "session",
    persistenceStatus,
    persistenceErrorCode,
  });

  return Object.freeze({
    schema: DIAGNOSTIC_JOURNAL_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    async appendUpdate(update, occurredAt = new Date().toISOString()) {
      const event = createUpdateDiagnosticEvent({ update, occurredAt });
      events = appendDiagnosticEvent(events, event, limit);
      await persist();
      return event;
    },
  });
}
