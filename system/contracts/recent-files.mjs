import { validateFileSpacePath } from "./file-space.mjs";

export const RECENT_FILES_SCHEMA = "ordax.recent-files/1";
export const MAX_RECENT_FILES = 32;

const PERSISTENCE_SCOPES = new Set(["device", "session"]);

export function validateRecentFilePath(path) {
  const validated = validateFileSpacePath(path);
  if (validated === "/") {
    throw new TypeError("Recent-files path must identify a file");
  }
  return validated;
}

export function recentFileName(path) {
  const validated = validateRecentFilePath(path);
  return validated.slice(validated.lastIndexOf("/") + 1);
}

export function validateRecentFileEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Recent-file entry must be an object");
  }
  const path = validateRecentFilePath(value.path);
  const name = recentFileName(path);
  if (value.name !== name) {
    throw new TypeError("Recent-file name must match its logical path");
  }
  if (!Number.isSafeInteger(value.openedAt) || value.openedAt < 0) {
    throw new TypeError("Recent-file openedAt must be a non-negative epoch millisecond");
  }
  return Object.freeze({ path, name, openedAt: value.openedAt });
}

export function validateRecentFileEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_RECENT_FILES) {
    throw new TypeError(`Recent-file entries must contain at most ${MAX_RECENT_FILES} items`);
  }
  const entries = value.map(validateRecentFileEntry);
  const paths = new Set(entries.map((entry) => entry.path));
  if (paths.size !== entries.length) {
    throw new TypeError("Recent-file entries must have unique logical paths");
  }
  return Object.freeze(entries);
}

export function validateRecentFilesSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Recent-files snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Recent-files persistence must be device or session");
  }
  return Object.freeze({
    persistence: value.persistence,
    entries: validateRecentFileEntries(value.entries),
  });
}

export function assertRecentFilesPort(port) {
  if (!port || typeof port !== "object" || port.schema !== RECENT_FILES_SCHEMA) {
    throw new TypeError("A compatible recent-files port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "recordOpened",
    "remove",
    "clear",
    "relocate",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Recent-files port must implement ${method}()`);
    }
  }
  validateRecentFilesSnapshot(port.getSnapshot());
  return port;
}
