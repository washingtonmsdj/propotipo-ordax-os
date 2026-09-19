import {
  MAX_NOTIFICATIONS,
  NOTIFICATIONS_SCHEMA,
  assertNotificationsPort,
  validateNotificationDraft,
  validateNotificationEntries,
  validateNotificationId,
  validateNotificationsSnapshot,
} from "../../contracts/notifications.mjs";
import {
  assertNotificationStore,
  validateNotificationStorePayload,
} from "../../contracts/notification-store.mjs";

function sameEntries(left, right) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const candidate = right[index];
    return entry.id === candidate.id
      && entry.read === candidate.read
      && entry.createdAt === candidate.createdAt
      && entry.sourceId === candidate.sourceId
      && entry.level === candidate.level
      && entry.title === candidate.title
      && entry.message === candidate.message
      && entry.destination?.appId === candidate.destination?.appId
      && entry.destination?.target === candidate.destination?.target;
  });
}

export function createNotificationsRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Notifications runtime requires a clock function");
  }
  const durableStore = store === null ? null : assertNotificationStore(store);
  let persistence = durableStore?.scope ?? "session";
  let entries = Object.freeze([]);
  let lastCreatedAt = -1;
  let ordinal = 0;
  const listeners = new Set();

  if (durableStore) {
    try {
      entries = validateNotificationStorePayload(durableStore.load());
      lastCreatedAt = entries.reduce(
        (maximum, entry) => Math.max(maximum, entry.createdAt),
        -1,
      );
    } catch {
      entries = Object.freeze([]);
      persistence = "session";
    }
  }

  const getSnapshot = () => validateNotificationsSnapshot({ persistence, entries });

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
    const validated = validateNotificationEntries(next);
    if (sameEntries(entries, validated)) return false;
    entries = validated;
    persist();
    emit();
    return true;
  };

  const nextCreatedAt = () => {
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new TypeError("Notifications clock must return a non-negative epoch millisecond");
    }
    lastCreatedAt = Math.max(current, lastCreatedAt + 1);
    return lastCreatedAt;
  };

  const nextId = (createdAt) => {
    do {
      ordinal += 1;
      const candidate = validateNotificationId(
        `notification-${createdAt.toString(36)}-${ordinal.toString(36)}`,
      );
      if (!entries.some((entry) => entry.id === candidate)) return candidate;
    } while (ordinal < Number.MAX_SAFE_INTEGER);
    throw new Error("Notification id space exhausted");
  };

  const port = {
    schema: NOTIFICATIONS_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Notifications listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(value) {
      const draft = validateNotificationDraft(value);
      const createdAt = nextCreatedAt();
      const entry = Object.freeze({
        id: nextId(createdAt),
        ...draft,
        createdAt,
        read: false,
      });
      replaceEntries([entry, ...entries].slice(0, MAX_NOTIFICATIONS));
      return entry;
    },
    markRead(id) {
      const target = validateNotificationId(id);
      replaceEntries(entries.map((entry) => (
        entry.id === target && !entry.read
          ? Object.freeze({ ...entry, read: true })
          : entry
      )));
      return getSnapshot();
    },
    markAllRead() {
      replaceEntries(entries.map((entry) => (
        entry.read ? entry : Object.freeze({ ...entry, read: true })
      )));
      return getSnapshot();
    },
    dismiss(id) {
      const target = validateNotificationId(id);
      replaceEntries(entries.filter((entry) => entry.id !== target));
      return getSnapshot();
    },
    clearRead() {
      replaceEntries(entries.filter((entry) => !entry.read));
      return getSnapshot();
    },
  };

  assertNotificationsPort(port);
  return Object.freeze(port);
}
