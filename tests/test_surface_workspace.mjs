import test from "node:test";
import assert from "node:assert/strict";

import {
  createSurfaceState,
  reduceSurfaceState,
} from "../system/surface/ui/surface-state.mjs";

function baseline() {
  return createSurfaceState({ capabilityIds: [], connectivity: "online" });
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
