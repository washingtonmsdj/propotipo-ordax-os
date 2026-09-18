import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  SYNC_RUNTIME_SCHEMA,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../preferences/appearance.mjs";
import {
  createAppearanceSyncMutation,
  createSyncMutationQueue,
  SYNC_CORE_STATUS,
} from "./runtime.mjs";

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

export function createPreferenceSyncRuntime(
  preferenceRuntime,
  {
    createIdempotencyKey,
    initialServerRevision = 0,
  } = {},
) {
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const nextIdempotencyKey = requireIdempotencyFactory(createIdempotencyKey);
  let serverRevision = requireServerRevision(initialServerRevision);
  let queue = createSyncMutationQueue();
  let destroyed = false;
  let lastTheme = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID];
  const listeners = new Set();

  const currentSnapshot = () => validateSyncRuntimeSnapshot({
    transport: SYNC_CORE_STATUS.transport,
    accountContinuity: SYNC_CORE_STATUS.accountContinuity,
    pendingMutationCount: queue.snapshot().length,
    trackedDataClasses: ["appearance"],
  });

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
    // Appearance is a single stable object. While transport is unavailable,
    // only the newest local value needs to remain pending for that object.
    queue = createSyncMutationQueue([mutation]);
    emit();
  };

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
