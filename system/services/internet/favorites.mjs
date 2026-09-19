import {
  BROWSER_FAVORITES_SCHEMA,
  MAX_BROWSER_FAVORITES,
  MAX_BROWSER_FAVORITE_TITLE_LENGTH,
  assertBrowserFavoritesPort,
  validateBrowserFavoriteId,
  validateBrowserFavorites,
  validateBrowserFavoritesSnapshot,
  validateBrowserFavoriteUrl,
} from "../../contracts/browser-favorites.mjs";
import {
  assertBrowserFavoritesStore,
  createEmptyBrowserFavoritesStoreState,
  validateBrowserFavoritesStoreState,
} from "../../contracts/browser-favorites-store.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Browser favorites runtime clock is invalid");
  }
  return value;
}

function boundedTitle(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Browser favorite title must be a string");
  }
  const title = value.trim();
  if (!title || title.length > MAX_BROWSER_FAVORITE_TITLE_LENGTH) {
    throw new TypeError("Browser favorite title is outside its allowed bounds");
  }
  return title;
}

function sameFavorites(left, right) {
  if (left.length !== right.length) return false;
  return left.every((favorite, index) => {
    const candidate = right[index];
    return favorite.id === candidate.id
      && favorite.url === candidate.url
      && favorite.title === candidate.title
      && favorite.createdAt === candidate.createdAt
      && favorite.updatedAt === candidate.updatedAt;
  });
}

export function createBrowserFavoritesRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Browser favorites runtime requires a clock");
  }
  const durableStore = store === null ? null : assertBrowserFavoritesStore(store);
  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyBrowserFavoritesStoreState();
  const listeners = new Set();
  let destroyed = false;

  if (durableStore) {
    try {
      state = validateBrowserFavoritesStoreState(durableStore.load());
    } catch {
      state = createEmptyBrowserFavoritesStoreState();
      persistence = "session";
    }
  }

  const snapshot = () => validateBrowserFavoritesSnapshot({
    persistence,
    favorites: state.favorites,
  });

  const emit = () => {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) listener(next);
  };

  const persist = (nextState) => {
    state = validateBrowserFavoritesStoreState(nextState);
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
    const validated = validateBrowserFavoritesStoreState(nextState);
    if (
      validated.nextOrdinal === state.nextOrdinal
      && sameFavorites(validated.favorites, state.favorites)
    ) {
      return false;
    }
    persist(validated);
    emit();
    return true;
  };

  const runtime = {
    schema: BROWSER_FAVORITES_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Browser favorites listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save({ url, title } = {}) {
      if (destroyed) return snapshot();
      const validUrl = validateBrowserFavoriteUrl(url);
      const validTitle = boundedTitle(title);
      const existingIndex = state.favorites.findIndex((favorite) => favorite.url === validUrl);

      if (existingIndex >= 0) {
        const existing = state.favorites[existingIndex];
        if (existing.title === validTitle) return snapshot();
        const updatedAt = Math.max(readClock(now), existing.createdAt, existing.updatedAt);
        const favorites = [...state.favorites];
        favorites[existingIndex] = Object.freeze({
          ...existing,
          title: validTitle,
          updatedAt,
        });
        replaceState({ nextOrdinal: state.nextOrdinal, favorites });
        return snapshot();
      }

      if (state.favorites.length >= MAX_BROWSER_FAVORITES) {
        throw new RangeError(
          `Browser favorites support at most ${MAX_BROWSER_FAVORITES} items`,
        );
      }

      const stamp = readClock(now);
      const favorite = Object.freeze({
        id: `favorite-${state.nextOrdinal}`,
        url: validUrl,
        title: validTitle,
        createdAt: stamp,
        updatedAt: stamp,
      });
      replaceState({
        nextOrdinal: state.nextOrdinal + 1,
        favorites: [favorite, ...state.favorites],
      });
      return snapshot();
    },
    remove(id) {
      if (destroyed) return snapshot();
      const favoriteId = validateBrowserFavoriteId(id);
      if (!state.favorites.some((favorite) => favorite.id === favoriteId)) {
        return snapshot();
      }
      replaceState({
        nextOrdinal: state.nextOrdinal,
        favorites: state.favorites.filter((favorite) => favorite.id !== favoriteId),
      });
      return snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };

  validateBrowserFavorites(state.favorites);
  assertBrowserFavoritesPort(runtime);
  return Object.freeze(runtime);
}
