import {
  COMPONENT_MANAGER_SCHEMA,
  COMPONENT_MANAGER_SNAPSHOT_SCHEMA,
  validateComponentId,
  validateComponentManagerSnapshot,
  validateComponentVersion,
} from "../../contracts/component-manager.mjs";
import {
  componentSupportsIndependentUpdate,
  validateComponentManifests,
} from "../../contracts/component-manifest.mjs";
import {
  COMPONENT_STATE_SCHEMA,
  assertComponentStateStore,
  createEmptyComponentState,
  validateComponentState,
} from "../../contracts/component-state-store.mjs";

const HEALTH_STATES = new Set(["unknown", "healthy", "failed"]);

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Component manager clock returned an invalid value");
  }
  return value;
}

function baselineEntry(manifest, now) {
  return Object.freeze({
    currentVersion: manifest.version,
    previousVersion: null,
    pendingVersion: null,
    rejectedVersion: null,
    currentHealth: "unknown",
    pendingHealth: "unknown",
    updatedAt: now,
  });
}

function copyEntry(entry, changes, now) {
  return Object.freeze({
    currentVersion: changes.currentVersion ?? entry.currentVersion,
    previousVersion: Object.hasOwn(changes, "previousVersion")
      ? changes.previousVersion
      : entry.previousVersion,
    pendingVersion: Object.hasOwn(changes, "pendingVersion")
      ? changes.pendingVersion
      : entry.pendingVersion,
    rejectedVersion: Object.hasOwn(changes, "rejectedVersion")
      ? changes.rejectedVersion
      : entry.rejectedVersion,
    currentHealth: changes.currentHealth ?? entry.currentHealth,
    pendingHealth: changes.pendingHealth ?? entry.pendingHealth,
    updatedAt: now,
  });
}

export function createComponentManager({
  manifests,
  store = null,
  now = Date.now,
} = {}) {
  const catalog = validateComponentManifests(manifests);
  if (typeof now !== "function") {
    throw new TypeError("Component manager requires a clock");
  }
  const stateStore = store === null ? null : assertComponentStateStore(store);
  const manifestById = new Map(catalog.map((manifest) => [manifest.id, manifest]));
  const listeners = new Set();
  let destroyed = false;
  let persistence = stateStore?.scope ?? "session";

  let loaded = createEmptyComponentState();
  if (stateStore) {
    try {
      const candidate = stateStore.load();
      if (candidate !== null && candidate !== undefined) {
        loaded = validateComponentState(candidate);
      }
    } catch {
      persistence = "session";
    }
  }

  const components = {};
  const initialNow = readClock(now);
  for (const manifest of catalog) {
    const stored = loaded.components[manifest.id];
    if (!componentSupportsIndependentUpdate(manifest)) {
      components[manifest.id] = baselineEntry(manifest, initialNow);
      continue;
    }
    components[manifest.id] = stored ?? baselineEntry(manifest, initialNow);
  }
  let state = Object.freeze({
    schema: COMPONENT_STATE_SCHEMA,
    revision: loaded.revision,
    components: Object.freeze(components),
  });

  const snapshot = () =>
    validateComponentManagerSnapshot({
      schema: COMPONENT_MANAGER_SNAPSHOT_SCHEMA,
      persistence,
      revision: state.revision,
      components: catalog.map((manifest) => ({
        manifest,
        state: state.components[manifest.id],
        independentUpdate: componentSupportsIndependentUpdate(manifest),
      })),
    });

  const emit = () => {
    if (destroyed) return;
    const next = snapshot();
    for (const listener of [...listeners]) listener(next);
  };

  const persist = (nextState) => {
    state = validateComponentState(nextState);
    if (!stateStore) {
      persistence = "session";
      return;
    }
    try {
      const result = stateStore.save(state);
      if (result === false) persistence = "session";
      else persistence = stateStore.scope;
    } catch {
      persistence = "session";
    }
  };

  const updateEntry = (componentId, changes) => {
    const manifest = manifestById.get(validateComponentId(componentId));
    if (!manifest) throw new TypeError(`Unknown component: ${componentId}`);
    const updatedAt = readClock(now);
    const nextComponents = {
      ...state.components,
      [componentId]: copyEntry(state.components[componentId], changes, updatedAt),
    };
    persist({
      schema: COMPONENT_STATE_SCHEMA,
      revision: state.revision + 1,
      components: nextComponents,
    });
    emit();
    return snapshot();
  };

  const requireIndependent = (componentId) => {
    const manifest = manifestById.get(validateComponentId(componentId));
    if (!manifest) throw new TypeError(`Unknown component: ${componentId}`);
    if (!componentSupportsIndependentUpdate(manifest)) {
      throw new TypeError(
        `Component ${componentId} is ${manifest.releaseMode}; individual slot operations are forbidden`,
      );
    }
    return manifest;
  };

  const manager = {
    schema: COMPONENT_MANAGER_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Component manager listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stageCandidate(componentId, version) {
      requireIndependent(componentId);
      const candidate = validateComponentVersion(version);
      const entry = state.components[componentId];
      if (candidate === entry.currentVersion) {
        throw new TypeError("Component candidate version already matches current");
      }
      return updateEntry(componentId, {
        pendingVersion: candidate,
        pendingHealth: "unknown",
      });
    },
    markPendingHealthy(componentId) {
      requireIndependent(componentId);
      const entry = state.components[componentId];
      if (entry.pendingVersion === null) {
        throw new TypeError("Component has no pending candidate");
      }
      return updateEntry(componentId, { pendingHealth: "healthy" });
    },
    promotePending(componentId) {
      requireIndependent(componentId);
      const entry = state.components[componentId];
      if (entry.pendingVersion === null || entry.pendingHealth !== "healthy") {
        throw new TypeError("Component pending candidate must be healthy before promotion");
      }
      return updateEntry(componentId, {
        previousVersion: entry.currentVersion,
        currentVersion: entry.pendingVersion,
        pendingVersion: null,
        rejectedVersion: null,
        currentHealth: "healthy",
        pendingHealth: "unknown",
      });
    },
    rejectPending(componentId) {
      requireIndependent(componentId);
      const entry = state.components[componentId];
      if (entry.pendingVersion === null) return snapshot();
      return updateEntry(componentId, {
        rejectedVersion: entry.pendingVersion,
        pendingVersion: null,
        pendingHealth: "unknown",
      });
    },
    rollback(componentId) {
      requireIndependent(componentId);
      const entry = state.components[componentId];
      if (entry.previousVersion === null) {
        throw new TypeError("Component has no previous version to roll back to");
      }
      return updateEntry(componentId, {
        currentVersion: entry.previousVersion,
        previousVersion: null,
        pendingVersion: null,
        rejectedVersion: entry.currentVersion,
        currentHealth: "unknown",
        pendingHealth: "unknown",
      });
    },
    setCurrentHealth(componentId, health) {
      validateComponentId(componentId);
      if (!manifestById.has(componentId)) {
        throw new TypeError(`Unknown component: ${componentId}`);
      }
      if (!HEALTH_STATES.has(health)) {
        throw new TypeError("Component health must be unknown, healthy or failed");
      }
      return updateEntry(componentId, { currentHealth: health });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };

  return Object.freeze(manager);
}
