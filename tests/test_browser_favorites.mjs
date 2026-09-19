import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_FAVORITES_SCHEMA,
  validateBrowserFavoritesSnapshot,
} from "../system/contracts/browser-favorites.mjs";
import {
  BROWSER_FAVORITES_STORE_SCHEMA,
  createEmptyBrowserFavoritesStoreState,
  validateBrowserFavoritesStoreState,
} from "../system/contracts/browser-favorites-store.mjs";
import { createNativeBrowserFavoritesStore } from "../system/adapters/native/browser-favorites.mjs";
import { createBrowserFavoritesRuntime } from "../system/services/internet/favorites.mjs";

function favoriteStore({ scope = "device", failSave = false } = {}) {
  let state = createEmptyBrowserFavoritesStoreState();
  return {
    schema: BROWSER_FAVORITES_STORE_SCHEMA,
    scope,
    load() {
      return state;
    },
    save(next) {
      state = validateBrowserFavoritesStoreState(next);
      return !failSave;
    },
  };
}

function localStorageWindow() {
  const values = new Map();
  return {
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    },
    values,
  };
}

test("browser favorites save canonical URLs and update one URL identity", () => {
  let clock = 100;
  const runtime = createBrowserFavoritesRuntime({
    store: favoriteStore(),
    now: () => clock++,
  });

  assert.equal(runtime.schema, BROWSER_FAVORITES_SCHEMA);
  runtime.save({ url: "https://EXAMPLE.org/docs", title: "Documentação" });
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.deepEqual(snapshot.favorites[0], {
    id: "favorite-1",
    url: "https://example.org/docs",
    title: "Documentação",
    createdAt: 100,
    updatedAt: 100,
  });

  runtime.save({ url: "https://example.org/docs", title: "Docs atualizadas" });
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.favorites.length, 1);
  assert.equal(snapshot.favorites[0].id, "favorite-1");
  assert.equal(snapshot.favorites[0].createdAt, 100);
  assert.equal(snapshot.favorites[0].updatedAt, 101);
  assert.equal(snapshot.favorites[0].title, "Docs atualizadas");
});

test("browser favorites reject unsupported or credential-bearing URLs before mutation", () => {
  const runtime = createBrowserFavoritesRuntime({
    store: favoriteStore(),
    now: () => 200,
  });
  const before = runtime.getSnapshot();

  assert.throws(
    () => runtime.save({ url: "javascript:alert(1)", title: "Unsafe" }),
    /http or https/,
  );
  assert.throws(
    () => runtime.save({ url: "https://user:secret@example.org/", title: "Unsafe" }),
    /credentials or host/,
  );
  assert.deepEqual(runtime.getSnapshot(), before);
});

test("browser favorites remove by stable id and preserve ordinal monotonicity", () => {
  let clock = 300;
  const runtime = createBrowserFavoritesRuntime({
    store: favoriteStore(),
    now: () => clock++,
  });
  runtime.save({ url: "https://one.example/", title: "One" });
  runtime.save({ url: "https://two.example/", title: "Two" });
  runtime.remove("favorite-1");
  runtime.save({ url: "https://three.example/", title: "Three" });

  assert.deepEqual(
    runtime.getSnapshot().favorites.map((favorite) => favorite.id),
    ["favorite-3", "favorite-2"],
  );
});

test("persistence failure degrades to session without losing favorite", () => {
  const runtime = createBrowserFavoritesRuntime({
    store: favoriteStore({ failSave: true }),
    now: () => 400,
  });
  const snapshot = runtime.save({
    url: "https://example.org/",
    title: "Example",
  });
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.favorites.length, 1);
});

test("native favorite store survives recreation and rejects corrupt records", () => {
  const windowRef = localStorageWindow();
  const store = createNativeBrowserFavoritesStore(windowRef);
  store.save({
    nextOrdinal: 2,
    favorites: [{
      id: "favorite-1",
      url: "https://example.org/",
      title: "Example",
      createdAt: 1,
      updatedAt: 1,
    }],
  });

  const restored = createNativeBrowserFavoritesStore(windowRef);
  assert.equal(restored.scope, "device");
  assert.equal(restored.load().favorites[0].url, "https://example.org/");

  windowRef.values.set("ordax.native.browser-favorites.v1", "{broken");
  const corrupt = createNativeBrowserFavoritesStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyBrowserFavoritesStoreState());
});

test("snapshot validation rejects duplicate favorite URLs", () => {
  assert.throws(
    () => validateBrowserFavoritesSnapshot({
      persistence: "device",
      favorites: [
        {
          id: "favorite-1",
          url: "https://example.org/",
          title: "One",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "favorite-2",
          url: "https://example.org/",
          title: "Two",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }),
    /only one favorite per URL/,
  );
});
