import {
  BROWSER_HISTORY_SCHEMA,
  MAX_BROWSER_HISTORY_ENTRIES,
  MAX_BROWSER_HISTORY_TITLE_LENGTH,
  assertBrowserHistoryPort,
  validateBrowserHistoryId,
  validateBrowserHistorySnapshot,
  validateBrowserHistoryUrl,
} from "../../../contracts/browser-history.mjs";
import {
  assertBrowserHistoryStore,
  createEmptyBrowserHistoryStoreState,
  validateBrowserHistoryStoreState,
} from "../../../contracts/browser-history-store.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Browser history runtime clock is invalid");
  }
  return value;
}

function historyTitle(value, url) {
  const source = typeof value === "string" ? value.trim() : "";
  if (source && !source.includes("\0") && source.length <= MAX_BROWSER_HISTORY_TITLE_LENGTH) {
    return source;
  }
  const fallback = new URL(url).hostname;
  return fallback.slice(0, MAX_BROWSER_HISTORY_TITLE_LENGTH);
}

function sameEntries(left, right) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const candidate = right[index];
    return entry.id === candidate.id
      && entry.url === candidate.url
      && entry.title === candidate.title
      && entry.visitedAt === candidate.visitedAt;
  });
}

export function createBrowserHistoryRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Browser history runtime requires a clock");
  }
  const durableStore = store === null ? null : assertBrowserHistoryStore(store);
  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyBrowserHistoryStoreState();
  const listeners = new Set();
  let destroyed = false;

  if (durableStore) {
    try {
      state = validateBrowserHistoryStoreState(durableStore.load());
    } catch {
      state = createEmptyBrowserHistoryStoreState();
      persistence = "session";
    }
  }

  const snapshot = () => validateBrowserHistorySnapshot({
    persistence,
    entries: state.entries,
  });

  const emit = () => {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) listener(next);
  };

  const persist = (nextState) => {
    state = validateBrowserHistoryStoreState(nextState);
    if (!durableStore) {
      persistence = "session";
      return;
    }
    try {
      const saved = durableStore.save(state) !== false;
      persistence = saved && durableStore.scope === "device" ? "device" : "session";
    } catch {
      persistence = "session";
    }
  };

  const replaceState = (nextState) => {
    const validated = validateBrowserHistoryStoreState(nextState);
    if (
      validated.nextOrdinal === state.nextOrdinal
      && sameEntries(validated.entries, state.entries)
    ) {
      return false;
    }
    persist(validated);
    emit();
    return true;
  };

  const runtime = {
    schema: BROWSER_HISTORY_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Browser history listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    record({ url, title = "" } = {}) {
      if (destroyed) return snapshot();
      const validUrl = validateBrowserHistoryUrl(url);
      const entry = Object.freeze({
        id: `history-${state.nextOrdinal}`,
        url: validUrl,
        title: historyTitle(title, validUrl),
        visitedAt: readClock(now),
      });
      replaceState({
        nextOrdinal: state.nextOrdinal + 1,
        entries: [entry, ...state.entries].slice(0, MAX_BROWSER_HISTORY_ENTRIES),
      });
      return snapshot();
    },
    remove(id) {
      if (destroyed) return snapshot();
      const historyId = validateBrowserHistoryId(id);
      if (!state.entries.some((entry) => entry.id === historyId)) {
        return snapshot();
      }
      replaceState({
        nextOrdinal: state.nextOrdinal,
        entries: state.entries.filter((entry) => entry.id !== historyId),
      });
      return snapshot();
    },
    clear() {
      if (destroyed || state.entries.length === 0) return snapshot();
      replaceState({
        nextOrdinal: state.nextOrdinal,
        entries: [],
      });
      return snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };

  assertBrowserHistoryPort(runtime);
  return Object.freeze(runtime);
}
