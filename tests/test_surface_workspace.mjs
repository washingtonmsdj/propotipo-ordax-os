import test from "node:test";
import assert from "node:assert/strict";

import { createNativeWorkspaceStore } from "../system/adapters/native/workspace.mjs";
import { createWebWorkspaceStore } from "../system/adapters/web/workspace.mjs";
import {
  MAX_WORKSPACE_AREAS,
  migrateLegacyWorkspaceRecord,
  validateWorkspaceRecord,
} from "../system/contracts/workspace-store.mjs";
import {
  createSurfaceState,
  createWorkspaceSnapshot,
  getActiveArea,
  reduceSurfaceState,
} from "../system/surface/ui/surface-state.mjs";

function baseline(workspaceSeed = null) {
  return createSurfaceState(
    { capabilityIds: [], connectivity: "online" },
    {},
    workspaceSeed,
  );
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    raw(key) {
      return values.get(key);
    },
  };
}

function active(state) {
  return getActiveArea(state);
}

function legacyWithFiles() {
  return {
    windows: [{
      id: "files",
      appId: "files",
      minimized: false,
      maximized: false,
      placementOrdinal: 1,
      positionX: 144,
      positionY: 96,
    }],
    activeWindowId: "files",
    nextWindowOrdinal: 2,
  };
}

test("default workspace starts with two real independent areas", () => {
  const state = baseline();
  assert.deepEqual(state.areas.map((area) => area.id), ["area-1", "area-2"]);
  assert.deepEqual(state.areas.map((area) => area.ordinal), [1, 2]);
  assert.equal(state.activeAreaId, "area-1");
  assert.equal(state.nextAreaOrdinal, 3);
  assert.equal(active(state).windows.length, 0);
});

test("launched windows receive stable placement ordinals inside the active area", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });

  assert.equal(active(state).windows.length, 2);
  assert.equal(active(state).windows[0].placementOrdinal, 1);
  assert.equal(active(state).windows[1].placementOrdinal, 2);
  assert.equal(state.areas[1].windows.length, 0);
});

test("focusing an already-active top window is a no-op", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  const focused = state;
  state = reduceSurfaceState(state, { type: "window.focus", windowId: "files" });
  assert.equal(state, focused);
});

test("area switching preserves independent window sets and focus", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 123.4, y: 87.6 });
  const firstArea = active(state);
  assert.equal(firstArea.windows[0].positionX, 123);
  assert.equal(firstArea.windows[0].positionY, 88);

  state = reduceSurfaceState(state, { type: "area.switch", areaId: "area-2" });
  assert.equal(active(state).windows.length, 0);
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });
  assert.deepEqual(active(state).windows.map((item) => item.id), ["settings"]);

  state = reduceSurfaceState(state, { type: "area.switch", areaId: "area-1" });
  assert.deepEqual(active(state).windows.map((item) => item.id), ["files"]);
  assert.equal(active(state).windows[0].positionX, 123);
  assert.equal(active(state).activeWindowId, "files");
});

test("app navigation targets are isolated per area and survive snapshot recovery", () => {
  let state = baseline();
  state = reduceSurfaceState(state, {
    type: "app.launch",
    appId: "system",
    target: "updates",
  });
  assert.equal(active(state).windows[0].target, "updates");

  state = reduceSurfaceState(state, { type: "area.switch", areaId: "area-2" });
  state = reduceSurfaceState(state, {
    type: "app.launch",
    appId: "system",
    target: "about",
  });
  assert.equal(active(state).windows[0].target, "about");

  const recovered = baseline(createWorkspaceSnapshot(state));
  assert.equal(recovered.activeAreaId, "area-2");
  assert.equal(recovered.areas[0].windows[0].target, "updates");
  assert.equal(recovered.areas[1].windows[0].target, "about");

  const firstArea = reduceSurfaceState(recovered, {
    type: "area.switch",
    areaId: "area-1",
  });
  assert.equal(active(firstArea).windows[0].target, "updates");
});

test("launch without a target preserves an existing singleton target", () => {
  let state = baseline();
  state = reduceSurfaceState(state, {
    type: "app.launch",
    appId: "settings",
    target: "network",
  });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });
  assert.equal(active(state).windows[0].target, "network");

  state = reduceSurfaceState(state, {
    type: "app.launch",
    appId: "settings",
    target: "appearance",
  });
  assert.equal(active(state).windows[0].target, "appearance");
});

test("workspace target validation is bounded and rejects control characters", () => {
  let state = baseline();
  assert.throws(
    () => reduceSurfaceState(state, {
      type: "app.launch",
      appId: "system",
      target: "bad\ntarget",
    }),
    TypeError,
  );
  assert.throws(
    () => reduceSurfaceState(state, {
      type: "app.launch",
      appId: "system",
      target: "x".repeat(4097),
    }),
    TypeError,
  );
});

test("new areas get monotonic identities and become active", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "area.create" });
  assert.equal(state.activeAreaId, "area-3");
  assert.equal(state.nextAreaOrdinal, 4);
  assert.deepEqual(state.areas.map((area) => area.ordinal), [1, 2, 3]);
  assert.equal(active(state).windows.length, 0);
});

test("area creation is bounded", () => {
  let state = baseline();
  while (state.areas.length < MAX_WORKSPACE_AREAS) {
    state = reduceSurfaceState(state, { type: "area.create" });
  }
  const saturated = state;
  state = reduceSurfaceState(state, { type: "area.create" });
  assert.equal(state, saturated);
  assert.equal(state.areas.length, MAX_WORKSPACE_AREAS);
});

test("maximize and movement are isolated to the active area", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 80, y: 64 });
  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "files" });
  const maximizedState = state;
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 300, y: 200 });
  assert.equal(state, maximizedState);
  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "files" });
  assert.equal(active(state).windows[0].positionX, 80);
  assert.equal(active(state).windows[0].positionY, 64);
});

test("invalid window coordinates fail closed", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  assert.throws(
    () => reduceSurfaceState(state, { type: "window.move", windowId: "files", x: -1, y: 10 }),
    TypeError,
  );
  assert.throws(
    () => reduceSurfaceState(state, { type: "window.move", windowId: "files", x: Number.NaN, y: 10 }),
    TypeError,
  );
});

test("workspace snapshot round-trips all areas and active area", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 144, y: 96 });
  state = reduceSurfaceState(state, { type: "area.switch", areaId: "area-2" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });
  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "settings" });

  const snapshot = createWorkspaceSnapshot(state);
  const recovered = baseline(snapshot);
  assert.equal(recovered.activeAreaId, "area-2");
  assert.equal(recovered.areas[0].windows[0].positionX, 144);
  assert.equal(recovered.areas[0].windows[0].positionY, 96);
  assert.equal(recovered.areas[1].windows[0].maximized, true);
  assert.equal(active(recovered).activeWindowId, "settings");
  assert.equal(recovered.launcherOpen, false);
});

test("workspace recovery drops unknown apps independently per area", () => {
  const persisted = validateWorkspaceRecord({
    activeAreaId: "area-1",
    nextAreaOrdinal: 3,
    areas: [
      {
        id: "area-1",
        ordinal: 1,
        windows: [
          {
            id: "files",
            appId: "files",
            minimized: false,
            maximized: false,
            placementOrdinal: 1,
            positionX: null,
            positionY: null,
          },
          {
            id: "ghost",
            appId: "ghost",
            minimized: false,
            maximized: false,
            placementOrdinal: 2,
            positionX: null,
            positionY: null,
          },
        ],
        activeWindowId: "ghost",
        nextWindowOrdinal: 3,
      },
      {
        id: "area-2",
        ordinal: 2,
        windows: [],
        activeWindowId: null,
        nextWindowOrdinal: 1,
      },
    ],
  });

  const recovered = baseline(persisted);
  assert.deepEqual(recovered.areas[0].windows.map((item) => item.id), ["files"]);
  assert.equal(recovered.areas[0].activeWindowId, "files");
  assert.equal(recovered.areas[0].nextWindowOrdinal, 3);
});

test("workspace contract rejects malformed area references and unbounded coordinates", () => {
  assert.throws(
    () => validateWorkspaceRecord({ activeAreaId: "area-9", nextAreaOrdinal: 3, areas: [] }),
    TypeError,
  );
  assert.throws(
    () => validateWorkspaceRecord({
      activeAreaId: "area-1",
      nextAreaOrdinal: 3,
      areas: [{
        id: "area-1",
        ordinal: 1,
        windows: [{
          id: "files",
          appId: "files",
          minimized: false,
          maximized: false,
          placementOrdinal: 1,
          positionX: 1_000_001,
          positionY: 0,
        }],
        activeWindowId: "files",
        nextWindowOrdinal: 2,
      }],
    }),
    TypeError,
  );
});

test("legacy v1 record migrates into Area 01 without losing layout", () => {
  const migrated = migrateLegacyWorkspaceRecord(legacyWithFiles());
  assert.equal(migrated.activeAreaId, "area-1");
  assert.equal(migrated.areas.length, 2);
  assert.equal(migrated.areas[0].windows[0].id, "files");
  assert.equal(migrated.areas[0].windows[0].positionX, 144);
  assert.equal(migrated.areas[1].windows.length, 0);
  assert.equal(migrated.nextAreaOrdinal, 3);
});

test("Web adapter migrates v1 only when v2 is absent", () => {
  const storage = createMemoryStorage();
  storage.setItem("ordax.workspace.v1", JSON.stringify(legacyWithFiles()));
  const store = createWebWorkspaceStore({ localStorage: storage });
  const loaded = store.load();
  assert.equal(loaded.areas[0].windows[0].id, "files");
  assert.equal(typeof storage.raw("ordax.workspace.v2"), "string");

  storage.setItem("ordax.workspace.v2", "{broken");
  const recovered = createWebWorkspaceStore({ localStorage: storage }).load();
  assert.equal(recovered.areas[0].windows.length, 0);
});

test("Native adapter migrates its own v1 namespace independently", () => {
  const storage = createMemoryStorage();
  storage.setItem("ordax.native.workspace.v1", JSON.stringify(legacyWithFiles()));
  const native = createNativeWorkspaceStore({ localStorage: storage }).load();
  const web = createWebWorkspaceStore({ localStorage: storage }).load();
  assert.equal(native.areas[0].windows[0].id, "files");
  assert.equal(web.areas[0].windows.length, 0);
  assert.equal(typeof storage.raw("ordax.native.workspace.v2"), "string");
  assert.equal(storage.raw("ordax.workspace.v2"), undefined);
});

test("Web and Native v2 stores persist independently", () => {
  const storage = createMemoryStorage();
  const windowRef = { localStorage: storage };
  const webStore = createWebWorkspaceStore(windowRef);
  const nativeStore = createNativeWorkspaceStore(windowRef);
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  const snapshot = createWorkspaceSnapshot(state);
  webStore.save(snapshot);

  assert.equal(createWebWorkspaceStore(windowRef).load().areas[0].windows.length, 1);
  assert.equal(createNativeWorkspaceStore(windowRef).load().areas[0].windows.length, 0);
  assert.equal(typeof storage.raw("ordax.workspace.v2"), "string");
  assert.equal(storage.raw("ordax.native.workspace.v2"), undefined);

  nativeStore.save(snapshot);
  assert.equal(createNativeWorkspaceStore(windowRef).load().areas[0].windows.length, 1);
  assert.equal(typeof storage.raw("ordax.native.workspace.v2"), "string");
});
