import { validateRecentFileEntries } from "./recent-files.mjs";

export const RECENT_FILES_STORE_SCHEMA = "ordax.recent-files-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function assertRecentFilesStore(store) {
  if (!store || typeof store !== "object" || store.schema !== RECENT_FILES_STORE_SCHEMA) {
    throw new TypeError("A compatible recent-files-store is required");
  }
  if (!STORE_SCOPES.has(store.scope)) {
    throw new TypeError("Recent-files-store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Recent-files-store must implement load() and save()");
  }
  return store;
}

export function validateRecentFilesStorePayload(value) {
  if (value === null || value === undefined) return Object.freeze([]);
  return validateRecentFileEntries(value);
}
