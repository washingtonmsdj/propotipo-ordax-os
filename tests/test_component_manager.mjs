import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPONENT_STATE_STORE_SCHEMA,
  createEmptyComponentState,
  validateComponentState,
} from "../system/contracts/component-state-store.mjs";
import {
  defineComponentManifest,
  validateComponentManifests,
} from "../system/contracts/component-manifest.mjs";
import { createNativeComponentStateStore } from "../system/adapters/native/component-state.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";

function baseManifest() {
  return defineComponentManifest({
    id: "ordax-base",
    title: "Base",
    kind: "base",
    version: "0.1.0",
    releaseMode: "base-ab",
    criticality: "boot-critical",
    failureDomain: "boot",
    restartScope: "reboot",
    healthMode: "boot",
    owner: "test/base",
    dependencies: [],
  });
}

function slotApp() {
  return defineComponentManifest({
    id: "slot-app",
    title: "Slot App",
    kind: "app",
    version: "1.0.0",
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "process",
    owner: "test/slot-app",
    dependencies: ["ordax-base"],
  });
}

function gitApp() {
  return defineComponentManifest({
    id: "git-app",
    title: "Git App",
    kind: "app",
    version: "1.2.0",
    releaseMode: "git-app",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner: "test/git-app",
    dependencies: ["ordax-base"],
  });
}

function bundledApp() {
  return defineComponentManifest({
    id: "bundled-app",
    title: "Bundled App",
    kind: "app",
    version: "1.0.0",
    releaseMode: "bundled",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "test/bundled-app",
    dependencies: ["ordax-base"],
  });
}

function memoryStore(initial = null) {
  let state = initial;
  return {
    schema: COMPONENT_STATE_STORE_SCHEMA,
    scope: "device",
    load() {
      return state;
    },
    save(next) {
      state = validateComponentState(next);
      return true;
    },
    read() {
      return state;
    },
  };
}

test("canonical component catalog has one unique owner identity per app and service", () => {
  const components = listSystemComponents();
  const ids = components.map((component) => component.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const required of [
    "ordax-base",
    "surface-shell",
    "update-service",
    "network-service",
    "power-service",
    "clock-service",
    "files",
    "notes",
    "internet",
    "settings",
    "account",
    "system",
  ]) {
    assert.ok(ids.includes(required), required);
  }
  const internet = components.find((component) => component.id === "internet");
  assert.equal(internet.version, "0.3.0");
  assert.equal(internet.releaseMode, "git-app");
  assert.equal(internet.owner, "system/apps/internet");
  const notes = components.find((component) => component.id === "notes");
  assert.equal(notes.version, "0.3.0");
  assert.equal(notes.releaseMode, "git-app");
  assert.equal(notes.owner, "system/apps/notes");
  const shell = components.find((component) => component.id === "surface-shell");
  assert.equal(shell.version, "0.3.0");
  const base = components.find((component) => component.id === "ordax-base");
  assert.equal(base.releaseMode, "base-ab");
});

test("component manifest rejects invalid A/B use and dependency cycles", () => {
  assert.throws(
    () => defineComponentManifest({
      id: "bad-app",
      title: "Bad",
      kind: "app",
      version: "1.0.0",
      releaseMode: "base-ab",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "surface",
      healthMode: "surface",
      owner: "tests/bad",
      dependencies: [],
    }),
    /A\/B release mode/,
  );

  const a = defineComponentManifest({
    id: "component-a",
    title: "A",
    kind: "service",
    version: "1.0.0",
    releaseMode: "bundled",
    criticality: "system",
    failureDomain: "service",
    restartScope: "component",
    healthMode: "process",
    owner: "tests/a",
    dependencies: ["component-b"],
  });
  const b = defineComponentManifest({
    id: "component-b",
    title: "B",
    kind: "service",
    version: "1.0.0",
    releaseMode: "bundled",
    criticality: "system",
    failureDomain: "service",
    restartScope: "component",
    healthMode: "process",
    owner: "tests/b",
    dependencies: ["component-a"],
  });
  assert.throws(() => validateComponentManifests([a, b]), /dependency cycle/);
});

test("component manager promotes only health-checked independent slots and rolls back locally", () => {
  let clock = 1000;
  const store = memoryStore();
  const manager = createComponentManager({
    manifests: [baseManifest(), slotApp(), gitApp(), bundledApp()],
    store,
    now: () => clock++,
  });

  assert.equal(manager.getSnapshot().persistence, "device");
  assert.throws(
    () => manager.stageCandidate("bundled-app", "1.1.0"),
    /individual slot operations are forbidden/,
  );
  assert.throws(
    () => manager.stageCandidate("git-app", "1.3.0"),
    /individual slot operations are forbidden/,
  );
  const gitDelivered = manager.getSnapshot().components.find(
    (item) => item.manifest.id === "git-app",
  );
  assert.equal(gitDelivered.state.currentVersion, "1.2.0");
  assert.equal(gitDelivered.state.pendingVersion, null);
  assert.equal(gitDelivered.independentUpdate, false);

  manager.stageCandidate("slot-app", "1.1.0");
  let slot = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-app");
  assert.equal(slot.state.currentVersion, "1.0.0");
  assert.equal(slot.state.pendingVersion, "1.1.0");
  assert.throws(() => manager.promotePending("slot-app"), /must be healthy/);

  manager.markPendingHealthy("slot-app");
  manager.promotePending("slot-app");
  slot = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-app");
  assert.equal(slot.state.currentVersion, "1.1.0");
  assert.equal(slot.state.previousVersion, "1.0.0");
  assert.equal(slot.state.pendingVersion, null);
  assert.equal(slot.state.currentHealth, "healthy");

  manager.setCurrentHealth("slot-app", "failed");
  manager.rollback("slot-app");
  slot = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-app");
  assert.equal(slot.state.currentVersion, "1.0.0");
  assert.equal(slot.state.previousVersion, null);
  assert.equal(slot.state.rejectedVersion, "1.1.0");
  assert.equal(slot.state.currentHealth, "unknown");
  assert.ok(store.read().revision >= 5);
  manager.destroy();
});

test("rejected pending candidate never becomes current", () => {
  const manager = createComponentManager({
    manifests: [baseManifest(), slotApp()],
    now: () => 2000,
  });
  manager.stageCandidate("slot-app", "2.0.0");
  manager.rejectPending("slot-app");
  const slot = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-app");
  assert.equal(slot.state.currentVersion, "1.0.0");
  assert.equal(slot.state.pendingVersion, null);
  assert.equal(slot.state.rejectedVersion, "2.0.0");
});

test("native component state adapter round-trips through its narrow endpoint", async () => {
  let payload = null;
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { payload };
          },
        };
      }
      payload = JSON.parse(options.body).payload;
      return { ok: true, status: 204 };
    },
  };
  const store = await createNativeComponentStateStore(windowRef);
  const state = createEmptyComponentState();
  assert.equal(store.save(state), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].url, "/__ordax/native/component-state");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "/__ordax/native/component-state");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(payload), state);
});
