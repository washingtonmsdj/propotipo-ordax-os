import test from "node:test";
import assert from "node:assert/strict";

import { createNativeWorkspaceStore } from "../system/adapters/native/workspace.mjs";
import { createWebWorkspaceStore } from "../system/adapters/web/workspace.mjs";
import { validateWorkspaceRecord } from "../system/contracts/workspace-store.mjs";
import {
  createSurfaceState,
  createWorkspaceSnapshot,
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

test("launched windows receive stable placement ordinals", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });

  assert.equal(state.windows.length, 2);
  assert.equal(state.windows[0].placementOrdinal, 1);
  assert.equal(state.windows[1].placementOrdinal, 2);
  assert.equal(state.windows[0].positionX, null);
  assert.equal(state.windows[0].positionY, null);
});

test("window movement is shared state and survives focus changes", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 123.4, y: 87.6 });

  let files = state.windows.find((item) => item.id === "files");
  assert.equal(files.positionX, 123);
  assert.equal(files.positionY, 88);

  state = reduceSurfaceState(state, { type: "window.focus", windowId: "files" });
  files = state.windows.find((item) => item.id === "files");
  assert.equal(files.positionX, 123);
  assert.equal(files.positionY, 88);
  assert.equal(files.placementOrdinal, 1);
});

test("maximize preserves restored position and blocks movement while maximized", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 80, y: 64 });
  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "files" });

  const maximizedState = state;
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 300, y: 200 });
  assert.equal(state, maximizedState);

  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "files" });
  const files = state.windows.find((item) => item.id === "files");
  assert.equal(files.maximized, false);
  assert.equal(files.positionX, 80);
  assert.equal(files.positionY, 64);
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

test("workspace snapshot round-trips window placement and state", () => {
  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  state = reduceSurfaceState(state, { type: "app.launch", appId: "settings" });
  state = reduceSurfaceState(state, { type: "window.move", windowId: "files", x: 144, y: 96 });
  state = reduceSurfaceState(state, { type: "window.maximize", windowId: "settings" });
  state = reduceSurfaceState(state, { type: "window.minimize", windowId: "files" });

  const snapshot = createWorkspaceSnapshot(state);
  const recovered = baseline(snapshot);
  const files = recovered.windows.find((item) => item.id === "files");
  const settings = recovered.windows.find((item) => item.id === "settings");

  assert.equal(files.positionX, 144);
  assert.equal(files.positionY, 96);
  assert.equal(files.minimized, true);
  assert.equal(settings.maximized, true);
  assert.equal(recovered.activeWindowId, "settings");
  assert.equal(recovered.nextWindowOrdinal, 3);
  assert.equal(recovered.launcherOpen, false);
});

test("workspace recovery drops unknown apps and duplicate singleton windows", () => {
  const persisted = validateWorkspaceRecord({
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
        id: "files:2",
        appId: "files",
        minimized: false,
        maximized: false,
        placementOrdinal: 2,
        positionX: 20,
        positionY: 20,
      },
      {
        id: "ghost",
        appId: "ghost",
        minimized: false,
        maximized: false,
        placementOrdinal: 3,
        positionX: null,
        positionY: null,
      },
    ],
    activeWindowId: "ghost",
    nextWindowOrdinal: 4,
  });

  const recovered = baseline(persisted);
  assert.deepEqual(recovered.windows.map((item) => item.id), ["files"]);
  assert.equal(recovered.activeWindowId, "files");
  assert.equal(recovered.nextWindowOrdinal, 4);
});

test("workspace contract rejects malformed references and unbounded coordinates", () => {
  assert.throws(
    () => validateWorkspaceRecord({ windows: [], activeWindowId: "files", nextWindowOrdinal: 1 }),
    TypeError,
  );
  assert.throws(
    () => validateWorkspaceRecord({
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
    }),
    TypeError,
  );
});

test("web and native workspace adapters persist independently", () => {
  const storage = createMemoryStorage();
  const windowRef = { localStorage: storage };
  const webStore = createWebWorkspaceStore(windowRef);
  const nativeStore = createNativeWorkspaceStore(windowRef);

  let state = baseline();
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" });
  const snapshot = createWorkspaceSnapshot(state);
  webStore.save(snapshot);

  assert.equal(createWebWorkspaceStore(windowRef).load().windows.length, 1);
  assert.equal(createNativeWorkspaceStore(windowRef).load().windows.length, 0);

  nativeStore.save(snapshot);
  assert.equal(createNativeWorkspaceStore(windowRef).load().windows.length, 1);
  assert.notEqual(storage.raw("ordax.workspace.v1"), storage.raw("ordax.native.workspace.v1"));
});

test("corrupt browser workspace state fails soft to an empty workspace", () => {
  const storage = createMemoryStorage();
  storage.setItem("ordax.workspace.v1", "{not-json");
  storage.setItem("ordax.native.workspace.v1", JSON.stringify({ windows: "bad" }));

  assert.deepEqual(createWebWorkspaceStore({ localStorage: storage }).load().windows, []);
  assert.deepEqual(createNativeWorkspaceStore({ localStorage: storage }).load().windows, []);
});
