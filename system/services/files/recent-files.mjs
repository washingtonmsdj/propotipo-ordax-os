import {
  MAX_RECENT_FILES,
  RECENT_FILES_SCHEMA,
  assertRecentFilesPort,
  recentFileName,
  validateRecentFileEntries,
  validateRecentFilePath,
  validateRecentFilesSnapshot,
} from "../../contracts/recent-files.mjs";
import {
  assertRecentFilesStore,
  validateRecentFilesStorePayload,
} from "../../contracts/recent-files-store.mjs";
import { validateFileSpacePath } from "../../contracts/file-space.mjs";

function sameEntries(left, right) {
  if (left.length !== right.length) return false;
  return left.every(
    (entry, index) =>
      entry.path === right[index].path
      && entry.name === right[index].name
      && entry.openedAt === right[index].openedAt,
  );
}

export function createRecentFilesRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Recent-files runtime requires a clock function");
  }
  const durableStore = store === null ? null : assertRecentFilesStore(store);
  let persistence = durableStore?.scope ?? "session";
  let entries = Object.freeze([]);
  const listeners = new Set();

  if (durableStore) {
    try {
      entries = validateRecentFilesStorePayload(durableStore.load());
    } catch {
      entries = Object.freeze([]);
      persistence = "session";
    }
  }

  const getSnapshot = () => validateRecentFilesSnapshot({ persistence, entries });

  const emit = () => {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const persist = () => {
    if (!durableStore) {
      persistence = "session";
      return;
    }
    try {
      const saved = durableStore.save(entries) !== false;
      persistence = saved && durableStore.scope === "device" ? "device" : "session";
    } catch {
      persistence = "session";
    }
  };

  const replaceEntries = (next) => {
    const validated = validateRecentFileEntries(next);
    if (sameEntries(entries, validated)) return false;
    entries = validated;
    persist();
    emit();
    return true;
  };

  const port = {
    schema: RECENT_FILES_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Recent-files listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recordOpened(path) {
      const validatedPath = validateRecentFilePath(path);
      const openedAt = now();
      const entry = {
        path: validatedPath,
        name: recentFileName(validatedPath),
        openedAt,
      };
      const remaining = entries.filter((candidate) => candidate.path !== validatedPath);
      replaceEntries([entry, ...remaining].slice(0, MAX_RECENT_FILES));
      return getSnapshot();
    },
    remove(path) {
      const validatedPath = validateRecentFilePath(path);
      replaceEntries(entries.filter((entry) => entry.path !== validatedPath));
      return getSnapshot();
    },
    clear() {
      replaceEntries([]);
      return getSnapshot();
    },
    relocate(fromPath, toPath) {
      const source = validateFileSpacePath(fromPath);
      const target = validateFileSpacePath(toPath);
      if (source === "/" || target === "/") {
        throw new TypeError("Recent-files relocation cannot target the logical root");
      }
      if (source === target) return getSnapshot();

      const relocated = [];
      const seen = new Set();
      for (const entry of entries) {
        let nextPath = entry.path;
        if (entry.path === source) {
          nextPath = target;
        } else if (entry.path.startsWith(`${source}/`)) {
          nextPath = `${target}${entry.path.slice(source.length)}`;
        }
        const next = {
          path: validateRecentFilePath(nextPath),
          name: recentFileName(nextPath),
          openedAt: entry.openedAt,
        };
        if (seen.has(next.path)) continue;
        seen.add(next.path);
        relocated.push(next);
      }
      replaceEntries(relocated);
      return getSnapshot();
    },
  };

  assertRecentFilesPort(port);
  return Object.freeze(port);
}
