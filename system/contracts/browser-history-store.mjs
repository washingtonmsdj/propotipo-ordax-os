import {
  MAX_BROWSER_HISTORY_ENTRIES,
  browserHistoryOrdinal,
  validateBrowserHistoryEntries,
} from "./browser-history.mjs";

export const BROWSER_HISTORY_STORE_SCHEMA = "ordax.browser-history-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function createEmptyBrowserHistoryStoreState() {
  return Object.freeze({
    nextOrdinal: 1,
    entries: Object.freeze([]),
  });
}

export function validateBrowserHistoryStoreState(value) {
  if (value === undefined || value === null) {
    return createEmptyBrowserHistoryStoreState();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser history store state must be an object");
  }
  const entries = validateBrowserHistoryEntries(value.entries);
  if (entries.length > MAX_BROWSER_HISTORY_ENTRIES) {
    throw new TypeError("Browser history store contains too many entries");
  }
  const highestOrdinal = entries.reduce(
    (highest, entry) => Math.max(highest, browserHistoryOrdinal(entry.id)),
    0,
  );
  if (
    !Number.isSafeInteger(value.nextOrdinal)
    || value.nextOrdinal < 1
    || value.nextOrdinal <= highestOrdinal
  ) {
    throw new TypeError("Browser history store nextOrdinal must exceed all ids");
  }
  return Object.freeze({
    nextOrdinal: value.nextOrdinal,
    entries,
  });
}

export function assertBrowserHistoryStore(store) {
  if (
    !store
    || store.schema !== BROWSER_HISTORY_STORE_SCHEMA
    || !STORE_SCOPES.has(store.scope)
  ) {
    throw new TypeError("A compatible browser history store is required");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Browser history store must implement load() and save(state)");
  }
  validateBrowserHistoryStoreState(store.load());
  return store;
}
