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
    snapshot = Object.freeze({ ...state });
    onState(snapshot);
    for (const listener of listeners) listener(snapshot);
  };

  const submitHealthIfNeeded = async () => {
    if (
      stopped ||
      !healthRequested ||
      !snapshot ||
      typeof snapshot.sourceSha !== "string" ||
      typeof snapshot.healthToken !== "string" ||
      snapshot.sourceSha.length === 0 ||
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
    if (stopped) {
      return;
    }
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
      if (!response.ok) {
        return;
      }

      const state = await response.json();
      if (!state || typeof state.sourceSha !== "string" || state.sourceSha.length === 0) {
        return;
      }

      notify(state);
      void submitHealthIfNeeded();
      if (observedSha === null) {
        observedSha = state.sourceSha;
        return;
      }

      const previousSha = observedSha;
      observedSha = state.sourceSha;
      if (shouldReloadForUpdate(previousSha, state)) {
        stopped = true;
        windowRef.location.reload();
      }
    } catch {
      // Network/update polling must never take the running Surface down.
    } finally {
      schedule();
    }
  };

  void poll();

  return Object.freeze({
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
