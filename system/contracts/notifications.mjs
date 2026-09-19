import { validateAppActivation } from "./app-activation.mjs";

export const NOTIFICATIONS_SCHEMA = "ordax.notifications/1";
export const MAX_NOTIFICATIONS = 64;

const LEVELS = new Set(["info", "success", "warning", "error"]);
const PERSISTENCE_SCOPES = new Set(["device", "session"]);
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  return value;
}

export function validateNotificationId(value) {
  return boundedText(value, "Notification id", 128);
}

export function validateNotificationDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification draft must be an object");
  }
  if (!SOURCE_ID_RE.test(value.sourceId ?? "")) {
    throw new TypeError("Notification sourceId is invalid");
  }
  if (!LEVELS.has(value.level)) {
    throw new TypeError("Notification level is invalid");
  }
  const destination = value.destination == null
    ? null
    : validateAppActivation(value.destination);
  return Object.freeze({
    sourceId: value.sourceId,
    level: value.level,
    title: boundedText(value.title, "Notification title", 96),
    message: boundedText(value.message, "Notification message", 360),
    destination,
  });
}

export function validateNotificationEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification entry must be an object");
  }
  const draft = validateNotificationDraft(value);
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new TypeError("Notification createdAt must be a non-negative epoch millisecond");
  }
  if (typeof value.read !== "boolean") {
    throw new TypeError("Notification read state must be boolean");
  }
  return Object.freeze({
    id: validateNotificationId(value.id),
    ...draft,
    createdAt: value.createdAt,
    read: value.read,
  });
}

export function validateNotificationEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_NOTIFICATIONS) {
    throw new TypeError(`Notification entries must contain at most ${MAX_NOTIFICATIONS} items`);
  }
  const entries = value.map(validateNotificationEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new TypeError("Notification entries must have unique ids");
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].createdAt < entries[index].createdAt) {
      throw new TypeError("Notification entries must be ordered newest first");
    }
  }
  return Object.freeze(entries);
}

export function validateNotificationsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notifications snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Notifications persistence must be device or session");
  }
  const entries = validateNotificationEntries(value.entries);
  return Object.freeze({
    persistence: value.persistence,
    unreadCount: entries.reduce((count, entry) => count + (entry.read ? 0 : 1), 0),
    entries,
  });
}

export function assertNotificationsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== NOTIFICATIONS_SCHEMA) {
    throw new TypeError("A compatible notifications port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "publish",
    "markRead",
    "markAllRead",
    "dismiss",
    "clearRead",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Notifications port must implement ${method}()`);
    }
  }
  validateNotificationsSnapshot(port.getSnapshot());
  return port;
}
