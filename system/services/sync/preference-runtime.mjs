import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  SYNC_RUNTIME_SCHEMA,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import { assertSyncStateStore } from "../../contracts/sync-state-store.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../preferences/appearance.mjs";
import {
  createAppearanceSyncMutation,
  createSyncMutationQueue,
  validateAppearanceSyncMutation,
  SYNC_CORE_STATUS,
} from "./runtime.mjs";

export const PREFERENCE_SYNC_STATE_SCHEMA = "ordax.preference-sync-state/1";

function requireIdempotencyFactory(value) {
  if (typeof value !== "function") {
    throw new TypeError("Preference sync bridge requires createIdempotencyKey()");
  }
  return value;
}

function requireServerRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("serverRevision must be a non-negative safe integer");
  }
  return value;
}

function recoverPersistedState(store, fallbackRevision) {
  if (!store) {
    return { serverRevision: fallbackRevision, mutations: [] };
  }
  const payload = store.load();
  if (payload === null) {
    return { serverRevision: fallbackRevision, mutations: [] };
  }
  try {
    const value = JSON.parse(payload);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.$schema !== PREFERENCE_SYNC_STATE_SCHEMA ||
      !Array.isArray(value.mutations) ||
      value.mutations.length > 1
    ) {
      throw new TypeError("Unsupported persisted preference sync state");
    }
    return {
      serverRevision: requireServerRevision(value.serverRevision),
      mutations: value.mutations.map(validateAppearanceSyncMutation),
    };
  } catch {
    return { serverRevision: fallbackRevision, mutations: [] };
  }
}

function serializeState(serverRevision, queue) {
  return JSON.stringify({
    $schema: PREFERENCE_SYNC_STATE_SCHEMA,
    serverRevision,
    mutations: queue.snapshot(),
  });
}

export function createPreferenceSyncRuntime(
  preferenceRuntime,
  {
    createIdempotencyKey,
    initialServerRevision = 0,
    syncStateStore = null,
  } = {},
) {
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const nextIdempotencyKey = requireIdempotencyFactory(createIdempotencyKey);
  const store = syncStateStore === null ? null : assertSyncStateStore(syncStateStore);
  const recovered = recoverPersistedState(
    store,
    requireServerRevision(initialServerRevision),
  );
  let serverRevision = recovered.serverRevision;
  let queue = createSyncMutationQueue(recovered.mutations);
  let destroyed = false;
  let queuePersistence = store?.scope ?? "session";
  let lastTheme = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID];
  const listeners = new Set();

  const currentSnapshot = () => validateSyncRuntimeSnapshot({
    transport: SYNC_CORE_STATUS.transport,
    accountContinuity: SYNC_CORE_STATUS.accountContinuity,
    pendingMutationCount: queue.snapshot().length,
    queuePersistence,
    trackedDataClasses: ["appearance"],
  });

  const persist = () => {
    if (!store) return false;
    const saved = store.save(serializeState(serverRevision, queue));
    if (saved === false) queuePersistence = "session";
    return saved;
  };

  const emit = () => {
    if (destroyed) return;
    const snapshot = currentSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const queueTheme = (theme) => {
    const mutation = createAppearanceSyncMutation({
      theme,
      baseServerRevision: serverRevision,
      idempotencyKey: nextIdempotencyKey(),
    });
    // Appearance is one stable object. Keep only the newest pending local value.
    queue = createSyncMutationQueue([mutation]);
    persist();
    emit();
  };

  const recoveredPending = queue.snapshot()[0] ?? null;
  if (recoveredPending && recoveredPending.payload.theme !== lastTheme) {
    queueTheme(lastTheme);
  }

  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    const theme = snapshot[APPEARANCE_PREFERENCE_ID];
    if (theme === lastTheme) return;
    lastTheme = theme;
    queueTheme(theme);
  });

  return Object.freeze({
    schema: SYNC_RUNTIME_SCHEMA,
    getSnapshot() {
      return currentSnapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Sync runtime listener must be a function");
      }
      listeners.add(listener);
      listener(currentSnapshot());
      return () => listeners.delete(listener);
    },
    pendingMutations() {
      return queue.snapshot();
    },
    acknowledge(idempotencyKey, nextServerRevision) {
      const revision = requireServerRevision(nextServerRevision);
      const removed = queue.acknowledge(idempotencyKey);
      if (!removed) return false;
      serverRevision = revision;
      persist();
      emit();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribePreferences();
      listeners.clear();
    },
  });
}
