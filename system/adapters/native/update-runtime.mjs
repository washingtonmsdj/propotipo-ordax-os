const UPDATE_STATE_PATH = "/__ordax/native/update";
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
  let stopped = false;
  let timer = null;

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

      onState(state);
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

  return {
    dispose() {
      stopped = true;
      if (timer !== null) {
        windowRef.clearTimeout(timer);
        timer = null;
      }
    },
    getObservedSha() {
      return observedSha;
    },
  };
}
