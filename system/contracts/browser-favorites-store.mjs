import {
  MAX_BROWSER_FAVORITES,
  browserFavoriteOrdinal,
  validateBrowserFavorites,
} from "./browser-favorites.mjs";

export const BROWSER_FAVORITES_STORE_SCHEMA = "ordax.browser-favorites-store/1";

const STORE_SCOPES = new Set(["device", "session"]);

export function createEmptyBrowserFavoritesStoreState() {
  return Object.freeze({
    nextOrdinal: 1,
    favorites: Object.freeze([]),
  });
}

export function validateBrowserFavoritesStoreState(value) {
  if (value === undefined || value === null) {
    return createEmptyBrowserFavoritesStoreState();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser favorites store state must be an object");
  }
  const favorites = validateBrowserFavorites(value.favorites);
  if (favorites.length > MAX_BROWSER_FAVORITES) {
    throw new TypeError("Browser favorites store contains too many items");
  }
  const highestOrdinal = favorites.reduce(
    (highest, favorite) => Math.max(highest, browserFavoriteOrdinal(favorite.id)),
    0,
  );
  if (
    !Number.isSafeInteger(value.nextOrdinal)
    || value.nextOrdinal < 1
    || value.nextOrdinal <= highestOrdinal
  ) {
    throw new TypeError("Browser favorites store nextOrdinal must exceed all ids");
  }
  return Object.freeze({
    nextOrdinal: value.nextOrdinal,
    favorites,
  });
}

export function assertBrowserFavoritesStore(store) {
  if (
    !store
    || store.schema !== BROWSER_FAVORITES_STORE_SCHEMA
    || !STORE_SCOPES.has(store.scope)
  ) {
    throw new TypeError("A compatible browser favorites store is required");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Browser favorites store must implement load() and save(state)");
  }
  validateBrowserFavoritesStoreState(store.load());
  return store;
}
