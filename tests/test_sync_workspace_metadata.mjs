import assert from "node:assert/strict";
import test from "node:test";

import { WORKSPACE_STORE_SCHEMA, validateWorkspaceRecord } from "../system/contracts/workspace-store.mjs";
import {
  createWorkspaceMetadata,
  createWorkspaceMetadataBridge,
} from "../system/services/sync/workspace-metadata.mjs";

function windowRecord({
  id,
  appId,
  ordinal,
  minimized = false,
  maximized = false,
  x = null,
  y = null,
}) {
  return {
    id,
    appId,
    minimized,
    maximized,
    placementOrdinal: ordinal,
    positionX: x,
    positionY: y,
  };
}

function workspaceWith(windowOverrides = {}) {
  return validateWorkspaceRecord({
    activeAreaId: "area-1",
    nextAreaOrdinal: 3,
    areas: [
      {
        id: "area-1",
        ordinal: 1,
        windows: [
          windowRecord({
            id: "files",
            appId: "files",
            ordinal: 1,
            ...windowOverrides,
          }),
        ],
        activeWindowId: "files",
        nextWindowOrdinal: 2,
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
}

function memoryStore(seed) {
  let value = seed;
  return {
    schema: WORKSPACE_STORE_SCHEMA,
    load() {
      return value;
    },
    save(next) {
      value = validateWorkspaceRecord(next);
      return true;
    },
  };
}

test("portable workspace metadata strips device-specific geometry and window flags", () => {
  const first = createWorkspaceMetadata(workspaceWith({
    minimized: true,
    maximized: false,
    x: 140,
    y: 96,
  }));
  const second = createWorkspaceMetadata(workspaceWith({
    minimized: false,
    maximized: true,
    x: 820,
    y: 540,
  }));

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    $schema: "ordax.workspace-metadata/1",
    activeAreaId: "area-1",
    areas: [
      { id: "area-1", ordinal: 1, appIds: ["files"] },
      { id: "area-2", ordinal: 2, appIds: [] },
    ],
  });
  assert.equal("positionX" in first.areas[0], false);
  assert.equal("maximized" in first.areas[0], false);
});

test("workspace metadata bridge emits only portable semantic changes", () => {
  const base = memoryStore(workspaceWith({ x: 40, y: 50 }));
  const bridge = createWorkspaceMetadataBridge(base);
  const snapshots = [];
  const unsubscribe = bridge.source.subscribe((snapshot) => snapshots.push(snapshot));

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].areas[0].appIds, ["files"]);

  bridge.store.save(workspaceWith({
    minimized: true,
    maximized: true,
    x: 600,
    y: 400,
  }));
  assert.equal(
    snapshots.length,
    1,
    "geometry/minimize/maximize changes must stay device-local",
  );

  const withSettings = validateWorkspaceRecord({
    activeAreaId: "area-2",
    nextAreaOrdinal: 3,
    areas: [
      {
        id: "area-1",
        ordinal: 1,
        windows: [windowRecord({ id: "files", appId: "files", ordinal: 1 })],
        activeWindowId: "files",
        nextWindowOrdinal: 2,
      },
      {
        id: "area-2",
        ordinal: 2,
        windows: [windowRecord({ id: "settings", appId: "settings", ordinal: 1 })],
        activeWindowId: "settings",
        nextWindowOrdinal: 2,
      },
    ],
  });
  bridge.store.save(withSettings);

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].activeAreaId, "area-2");
  assert.deepEqual(snapshots[1].areas[1].appIds, ["settings"]);

  unsubscribe();
});
