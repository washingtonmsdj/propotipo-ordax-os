export const BROWSER_HISTORY_SCHEMA = "ordax.browser-history/1";
export const MAX_BROWSER_HISTORY_ENTRIES = 512;
export const MAX_BROWSER_HISTORY_TITLE_LENGTH = 256;
export const MAX_BROWSER_HISTORY_URL_LENGTH = 4096;

const HISTORY_ID_RE = /^history-[1-9][0-9]*$/;
const PERSISTENCE_SCOPES = new Set(["device", "session"]);

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const text = value.trim();
  if (!text || text.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return text;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

export function validateBrowserHistoryId(value) {
  if (typeof value !== "string" || !HISTORY_ID_RE.test(value)) {
    throw new TypeError("Browser history id is invalid");
  }
  return value;
}

export function browserHistoryOrdinal(value) {
  const id = validateBrowserHistoryId(value);
  const ordinal = Number(id.slice("history-".length));
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError("Browser history ordinal is invalid");
  }
  return ordinal;
}

export function validateBrowserHistoryUrl(value) {
  const source = boundedText(
    value,
    "Browser history URL",
    MAX_BROWSER_HISTORY_URL_LENGTH,
  );
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("Browser history URL is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError("Browser history URL must use http or https");
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new TypeError("Browser history URL contains unsupported credentials or host");
  }
  if (parsed.href.length > MAX_BROWSER_HISTORY_URL_LENGTH) {
    throw new TypeError("Browser history URL is too long");
  }
  return parsed.href;
}

export function validateBrowserHistoryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser history entry must be an object");
  }
  return Object.freeze({
    id: validateBrowserHistoryId(value.id),
    url: validateBrowserHistoryUrl(value.url),
    title: boundedText(
      value.title,
      "Browser history title",
      MAX_BROWSER_HISTORY_TITLE_LENGTH,
    ),
    visitedAt: timestamp(value.visitedAt, "Browser history visitedAt"),
  });
}

export function validateBrowserHistoryEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_BROWSER_HISTORY_ENTRIES) {
    throw new TypeError(
      `Browser history must contain at most ${MAX_BROWSER_HISTORY_ENTRIES} entries`,
    );
  }
  const entries = value.map(validateBrowserHistoryEntry);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new TypeError("Browser history ids must be unique");
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].visitedAt < entries[index].visitedAt) {
      throw new TypeError("Browser history entries must be newest first");
    }
  }
  return Object.freeze(entries);
}

export function validateBrowserHistorySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser history snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Browser history persistence must be device or session");
  }
  return Object.freeze({
    persistence: value.persistence,
    entries: validateBrowserHistoryEntries(value.entries),
  });
}

export function assertBrowserHistoryPort(port) {
  if (!port || port.schema !== BROWSER_HISTORY_SCHEMA) {
    throw new TypeError("A compatible browser history port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "record", "remove", "clear", "destroy"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Browser history port must implement ${method}()`);
    }
  }
  validateBrowserHistorySnapshot(port.getSnapshot());
  return port;
}
