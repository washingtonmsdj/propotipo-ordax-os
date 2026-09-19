import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { listSystemComponents } from "../system/services/components/catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";
import {
  loadManagedComponentRuntime,
  loadOptionalComponentRuntime,
} from "../system/services/components/runtime-loader.mjs";

function createManager() {
  return createComponentManager({
    manifests: listSystemComponents(),
    now: (() => {
      let value = 1000;
      return () => value++;
    })(),
  });
}

function createIndependentManager() {
  return createComponentManager({
    manifests: listSystemComponents().map((manifest) => (
      manifest.id === "internet"
        ? { ...manifest, releaseMode: "component-slot" }
        : manifest
    )),
    now: (() => {
      let value = 2000;
      return () => value++;
    })(),
  });
}

function componentState(manager, componentId) {
  return manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  ).state;
}

function healthOf(manager, componentId) {
  return manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  ).state.currentHealth;
}

test("optional component runtime mounts and reports its own health", async () => {
  const manager = createManager();
  let mountedContext = null;
  let destroyed = false;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    context: { marker: "context-ok" },
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "internet",
        version: "0.3.0",
        async mount(context) {
          mountedContext = context;
          return { destroy() { destroyed = true; } };
        },
      },
    }),
  });

  assert.equal(mountedContext.marker, "context-ok");
  assert.equal(healthOf(manager, "internet"), "healthy");
  assert.notEqual(mounted, null);
  mounted.destroy();
  assert.equal(destroyed, true);
  manager.destroy();
});

test("import failure is contained inside the component failure domain", async () => {
  const manager = createManager();
  manager.setCurrentHealth("surface-shell", "healthy");
  let reported = null;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => {
      throw new SyntaxError("broken optional runtime");
    },
    onError(error) {
      reported = error;
    },
  });

  assert.equal(mounted, null);
  assert.equal(reported?.name, "SyntaxError");
  assert.equal(healthOf(manager, "internet"), "failed");
  assert.equal(healthOf(manager, "surface-shell"), "healthy");
  manager.destroy();
});

test("runtime version mismatch fails closed without mounting stale code", async () => {
  const manager = createManager();
  let mountCalls = 0;
  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "internet",
        version: "0.1.0",
        mount() {
          mountCalls += 1;
          return { destroy() {} };
        },
      },
    }),
  });

  assert.equal(mounted, null);
  assert.equal(mountCalls, 0);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});

test("malformed mounted runtime is isolated as component failure", async () => {
  const manager = createManager();
  const mounted = await loadOptionalComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    importer: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "internet",
        version: "0.3.0",
        mount() {
          return {};
        },
      },
    }),
  });

  assert.equal(mounted, null);
  assert.equal(healthOf(manager, "internet"), "failed");
  manager.destroy();
});


test("healthy pending runtime is probed before current/previous promotion", async () => {
  const manager = createIndependentManager();
  manager.stageCandidate("internet", "0.4.0");

  let pendingImportedVersion = null;
  let currentImports = 0;
  const mounted = await loadManagedComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    currentImporter: async () => {
      currentImports += 1;
      throw new Error("current importer should not run after healthy pending promotion");
    },
    pendingImporter: async (version) => {
      pendingImportedVersion = version;
      return {
        componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "internet",
          version: "0.4.0",
          async mount() {
            return {
              async probeHealth() {
                return true;
              },
              destroy() {},
            };
          },
        },
      };
    },
  });

  assert.notEqual(mounted, null);
  assert.equal(pendingImportedVersion, "0.4.0");
  assert.equal(currentImports, 0);
  assert.deepEqual(
    {
      currentVersion: componentState(manager, "internet").currentVersion,
      previousVersion: componentState(manager, "internet").previousVersion,
      pendingVersion: componentState(manager, "internet").pendingVersion,
      rejectedVersion: componentState(manager, "internet").rejectedVersion,
      currentHealth: componentState(manager, "internet").currentHealth,
    },
    {
      currentVersion: "0.4.0",
      previousVersion: "0.3.0",
      pendingVersion: null,
      rejectedVersion: null,
      currentHealth: "healthy",
    },
  );

  let reloadedCurrentVersion = null;
  mounted.destroy();
  const reloaded = await loadManagedComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    currentImporter: async (version) => {
      reloadedCurrentVersion = version;
      return {
        componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "internet",
          version,
          mount() {
            return { destroy() {} };
          },
        },
      };
    },
  });
  assert.notEqual(reloaded, null);
  assert.equal(reloadedCurrentVersion, "0.4.0");
  reloaded.destroy();
  manager.destroy();
});

test("failed pending health is rejected and current runtime is restored", async () => {
  const manager = createIndependentManager();
  manager.setCurrentHealth("surface-shell", "healthy");
  manager.stageCandidate("internet", "0.4.0");

  let pendingDestroyed = false;
  let pendingError = null;
  let currentImportedVersion = null;
  const mounted = await loadManagedComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    pendingImporter: async (version) => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "internet",
        version,
        mount() {
          return {
            async probeHealth() {
              return false;
            },
            destroy() {
              pendingDestroyed = true;
            },
          };
        },
      },
    }),
    currentImporter: async (version) => {
      currentImportedVersion = version;
      return {
        componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "internet",
          version,
          mount() {
            return { destroy() {} };
          },
        },
      };
    },
    onPendingError(error) {
      pendingError = error;
    },
  });

  assert.notEqual(mounted, null);
  assert.equal(pendingDestroyed, true);
  assert.match(pendingError?.message ?? "", /pending health probe/);
  assert.equal(currentImportedVersion, "0.3.0");
  assert.deepEqual(
    {
      currentVersion: componentState(manager, "internet").currentVersion,
      previousVersion: componentState(manager, "internet").previousVersion,
      pendingVersion: componentState(manager, "internet").pendingVersion,
      rejectedVersion: componentState(manager, "internet").rejectedVersion,
      currentHealth: componentState(manager, "internet").currentHealth,
    },
    {
      currentVersion: "0.3.0",
      previousVersion: null,
      pendingVersion: null,
      rejectedVersion: "0.4.0",
      currentHealth: "healthy",
    },
  );
  assert.equal(healthOf(manager, "surface-shell"), "healthy");

  mounted.destroy();
  manager.destroy();
});

test("pending runtime without explicit health probe cannot be promoted", async () => {
  const manager = createIndependentManager();
  manager.stageCandidate("internet", "0.4.0");
  let currentImportedVersion = null;

  const mounted = await loadManagedComponentRuntime({
    componentId: "internet",
    componentManager: manager,
    pendingImporter: async (version) => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "internet",
        version,
        mount() {
          return { destroy() {} };
        },
      },
    }),
    currentImporter: async (version) => {
      currentImportedVersion = version;
      return {
        componentRuntime: {
          schema: COMPONENT_RUNTIME_SCHEMA,
          componentId: "internet",
          version,
          mount() {
            return { destroy() {} };
          },
        },
      };
    },
  });

  assert.notEqual(mounted, null);
  assert.equal(currentImportedVersion, "0.3.0");
  assert.equal(componentState(manager, "internet").currentVersion, "0.3.0");
  assert.equal(componentState(manager, "internet").rejectedVersion, "0.4.0");
  mounted.destroy();
  manager.destroy();
});
