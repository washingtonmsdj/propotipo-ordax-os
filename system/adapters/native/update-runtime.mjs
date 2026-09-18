import {
  UPDATE_STATUS_SCHEMA,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";

const UPDATE_STATE_PATH = "/__ordax/native/update";
const UPDATE_HEALTH_PATH = "/__ordax/native/health";
const HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token";
const DEFAULT_INTERVAL_MS = 1500;

export function shouldReloadForUpdate(previousSha, state) {
  if (!previousSha || !state || typeof state !== "object") {
    return false;
  }
  return (
    typeof state.sourceSha === "string" &&
    state.sourceSha.length > 0 &&
    state.sourceSha !== previousSha &&
    state.applyMode === "reload"
  );
}

export function createNativeUpdateWatcher(
  windowRef,
  { intervalMs = DEFAULT_INTERVAL_MS, onState = () => {} } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new Error("native update watcher requires window.fetch");
  }
  if (!windowRef.location || typeof windowRef.location.reload !== "function") {
    throw new Error("native update watcher requires window.location.reload");
  }
  if (typeof windowRef.setTimeout !== "function" || typeof windowRef.clearTimeout !== "function") {
    throw new Error("native update watcher requires timer APIs");
  }

  let observedSha = null;
  let snapshot = null;
  let stopped = false;
  let timer = null;
  let healthRequested = false;
  let healthSubmittedSha = null;
  const listeners = new Set();

  const notify = (state) => {
    snapshot = validateUpdateStatusSnapshot(state);
    onState(snapshot);
    for (const listener of listeners) listener(snapshot);
  };

  const submitHealthIfNeeded = async () => {
    if (
      stopped ||
      !healthRequested ||
      !snapshot ||
      snapshot.healthToken.length === 0 ||
      healthSubmittedSha === snapshot.sourceSha
    ) {
      return false;
    }
    try {
      const response = await windowRef.fetch(UPDATE_HEALTH_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [HEALTH_TOKEN_HEADER]: snapshot.healthToken,
        },
        body: JSON.stringify({ sourceSha: snapshot.sourceSha }),
      });
      if (!response.ok) return false;
      healthSubmittedSha = snapshot.sourceSha;
      return true;
    } catch {
      return false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = windowRef.setTimeout(() => {
      void poll();
    }, intervalMs);
  };

  const poll = async () => {
    try {
      const response = await windowRef.fetch(UPDATE_STATE_PATH, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;

      const state = await response.json();
      if (!state || typeof state.sourceSha !== "string" || state.sourceSha.length === 0) return;

      notify(state);
      if (observedSha === null) {
        observedSha = snapshot.sourceSha;
        void submitHealthIfNeeded();
        return;
      }

      const previousSha = observedSha;
      observedSha = snapshot.sourceSha;
      if (shouldReloadForUpdate(previousSha, snapshot)) {
        stopped = true;
        if (timer !== null) {
          windowRef.clearTimeout(timer);
          timer = null;
        }
        windowRef.location.reload();
        return;
      }

      void submitHealthIfNeeded();
    } catch {
      // Network/update polling must never take the running Surface down.
    } finally {
      schedule();
    }
  };

  void poll();

  return Object.freeze({
    schema: UPDATE_STATUS_SCHEMA,
    dispose() {
      stopped = true;
      if (timer !== null) {
        windowRef.clearTimeout(timer);
        timer = null;
      }
      listeners.clear();
    },
    getObservedSha() {
      return observedSha;
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("update watcher subscriber must be a function");
      }
      listeners.add(listener);
      if (snapshot) listener(snapshot);
      return () => listeners.delete(listener);
    },
    markHealthy() {
      healthRequested = true;
      return submitHealthIfNeeded();
    },
  });
}
