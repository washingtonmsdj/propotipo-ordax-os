import { assertComponentManager } from "../../contracts/component-manager.mjs";
import {
  probeMountedComponentHealth,
  validateComponentRuntime,
  validateMountedComponent,
} from "../../contracts/component-runtime.mjs";

function componentRecord(manager, componentId) {
  const record = manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  );
  if (!record) throw new TypeError(`Unknown component runtime: ${componentId}`);
  return record;
}

function expectedCurrentVersion(record) {
  return record.independentUpdate
    ? record.state.currentVersion
    : record.manifest.version;
}

async function importAndMount({
  componentId,
  version,
  importer,
  context,
} = {}) {
  const module = await importer(version);
  const runtime = validateComponentRuntime(module?.componentRuntime, {
    componentId,
    version,
  });
  return validateMountedComponent(
    await runtime.mount(context),
    componentId,
  );
}

export async function loadOptionalComponentRuntime({
  componentId,
  importer,
  context = Object.freeze({}),
  componentManager,
  onError = null,
} = {}) {
  if (typeof componentId !== "string" || !componentId) {
    throw new TypeError("Optional component runtime requires componentId");
  }
  if (typeof importer !== "function") {
    throw new TypeError(`Optional component ${componentId} requires importer()`);
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Optional component onError must be a function or null");
  }

  const manager = assertComponentManager(componentManager);
  const expected = componentRecord(manager, componentId);
  const version = expectedCurrentVersion(expected);

  try {
    const mounted = await importAndMount({
      componentId,
      version,
      importer,
      context,
    });
    manager.setCurrentHealth(componentId, "healthy");
    return mounted;
  } catch (error) {
    try {
      manager.setCurrentHealth(componentId, "failed");
    } catch {
      // Health reporting must never turn an optional-component failure into a Surface failure.
    }
    if (onError) onError(error);
    return null;
  }
}

export async function loadPendingComponentRuntime({
  componentId,
  importer,
  context = Object.freeze({}),
  componentManager,
  onError = null,
} = {}) {
  if (typeof componentId !== "string" || !componentId) {
    throw new TypeError("Pending component runtime requires componentId");
  }
  if (typeof importer !== "function") {
    throw new TypeError(`Pending component ${componentId} requires importer(version)`);
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Pending component onError must be a function or null");
  }

  const manager = assertComponentManager(componentManager);
  const expected = componentRecord(manager, componentId);
  if (!expected.independentUpdate) {
    throw new TypeError(
      `Component ${componentId} does not support pending slot activation`,
    );
  }
  const version = expected.state.pendingVersion;
  if (version === null) return null;

  let mounted = null;
  try {
    mounted = await importAndMount({
      componentId,
      version,
      importer,
      context,
    });
    await probeMountedComponentHealth(mounted, componentId);
    manager.markPendingHealthy(componentId);
    manager.promotePending(componentId);
    return mounted;
  } catch (error) {
    if (mounted) {
      try {
        mounted.destroy();
      } catch {
        // A broken pending component cannot prevent rollback to the current component.
      }
    }
    try {
      manager.rejectPending(componentId);
    } catch {
      // Pending rejection must remain contained inside the component failure domain.
    }
    if (onError) onError(error);
    return null;
  }
}

export async function loadManagedComponentRuntime({
  componentId,
  currentImporter,
  pendingImporter = null,
  context = Object.freeze({}),
  componentManager,
  onCurrentError = null,
  onPendingError = null,
} = {}) {
  if (typeof currentImporter !== "function") {
    throw new TypeError(`Managed component ${componentId} requires currentImporter(version)`);
  }
  const manager = assertComponentManager(componentManager);
  const expected = componentRecord(manager, componentId);

  if (expected.independentUpdate && expected.state.pendingVersion !== null) {
    if (typeof pendingImporter !== "function") {
      throw new TypeError(
        `Managed component ${componentId} has a pending version but no pendingImporter(version)`,
      );
    }
    const pending = await loadPendingComponentRuntime({
      componentId,
      importer: pendingImporter,
      context,
      componentManager: manager,
      onError: onPendingError,
    });
    if (pending) return pending;
  }

  return loadOptionalComponentRuntime({
    componentId,
    importer: currentImporter,
    context,
    componentManager: manager,
    onError: onCurrentError,
  });
}
