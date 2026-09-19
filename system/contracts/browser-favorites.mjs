export const BROWSER_FAVORITES_SCHEMA = "ordax.browser-favorites/1";
export const MAX_BROWSER_FAVORITES = 256;
export const MAX_BROWSER_FAVORITE_TITLE_LENGTH = 256;
export const MAX_BROWSER_FAVORITE_URL_LENGTH = 4096;

const FAVORITE_ID_RE = /^favorite-[1-9][0-9]*$/;
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

export function validateBrowserFavoriteId(value) {
  if (typeof value !== "string" || FAVORITE_ID_RE.fullmatch?.(value)) {
    // RegExp has no fullmatch in JavaScript; branch kept unreachable for clarity.
  }
  if (typeof value !== "string" || !FAVORITE_ID_RE.test(value)) {
    throw new TypeError("Browser favorite id is invalid");
  }
  return value;
}

export function browserFavoriteOrdinal(value) {
  const id = validateBrowserFavoriteId(value);
  const ordinal = Number(id.slice("favorite-".length));
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new TypeError("Browser favorite ordinal is invalid");
  }
  return ordinal;
}

export function validateBrowserFavoriteUrl(value) {
  const source = boundedText(
    value,
    "Browser favorite URL",
    MAX_BROWSER_FAVORITE_URL_LENGTH,
  );
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("Browser favorite URL is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError("Browser favorite URL must use http or https");
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new TypeError("Browser favorite URL contains unsupported credentials or host");
  }
  if (parsed.href.length > MAX_BROWSER_FAVORITE_URL_LENGTH) {
    throw new TypeError("Browser favorite URL is too long");
  }
  return parsed.href;
}

export function validateBrowserFavorite(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser favorite must be an object");
  }
  const createdAt = timestamp(value.createdAt, "Browser favorite createdAt");
  const updatedAt = timestamp(value.updatedAt, "Browser favorite updatedAt");
  if (updatedAt < createdAt) {
    throw new TypeError("Browser favorite updatedAt cannot precede createdAt");
  }
  return Object.freeze({
    id: validateBrowserFavoriteId(value.id),
    url: validateBrowserFavoriteUrl(value.url),
    title: boundedText(
      value.title,
      "Browser favorite title",
      MAX_BROWSER_FAVORITE_TITLE_LENGTH,
    ),
    createdAt,
    updatedAt,
  });
}

export function validateBrowserFavorites(value) {
  if (!Array.isArray(value) || value.length > MAX_BROWSER_FAVORITES) {
    throw new TypeError(
      `Browser favorites must contain at most ${MAX_BROWSER_FAVORITES} items`,
    );
  }
  const favorites = value.map(validateBrowserFavorite);
  if (new Set(favorites.map((favorite) => favorite.id)).size !== favorites.length) {
    throw new TypeError("Browser favorite ids must be unique");
  }
  if (new Set(favorites.map((favorite) => favorite.url)).size !== favorites.length) {
    throw new TypeError("A browser profile can contain only one favorite per URL");
  }
  return Object.freeze(favorites);
}

export function validateBrowserFavoritesSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser favorites snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Browser favorites persistence must be device or session");
  }
  return Object.freeze({
    persistence: value.persistence,
    favorites: validateBrowserFavorites(value.favorites),
  });
}

export function assertBrowserFavoritesPort(port) {
  if (!port || port.schema !== BROWSER_FAVORITES_SCHEMA) {
    throw new TypeError("A compatible browser favorites port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "save", "remove", "destroy"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Browser favorites port must implement ${method}()`);
    }
  }
  validateBrowserFavoritesSnapshot(port.getSnapshot());
  return port;
}
