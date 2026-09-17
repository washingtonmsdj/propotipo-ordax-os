export const WORKSPACE_STORE_SCHEMA = "ordax.workspace-store/1";

const WINDOW_ID_RE = /^[a-z][a-z0-9-]*(?::[1-9][0-9]*)?$/;
const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const MAX_WINDOWS = 32;
const MAX_COORDINATE = 1_000_000;

function optionalCoordinate(value, field) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > MAX_COORDINATE) {
    throw new TypeError(`Workspace ${field} must be null or a bounded non-negative number`);
  }
  return Math.round(value);
}

function positiveOrdinal(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Workspace ${field} must be a positive safe integer`);
  }
  return value;
}

export function validateWorkspaceRecord(value) {
  if (value === undefined || value === null) {
    value = { windows: [], activeWindowId: null, nextWindowOrdinal: 1 };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workspace store payload must be an object");
  }
  if (!Array.isArray(value.windows) || value.windows.length > MAX_WINDOWS) {
    throw new TypeError("Workspace windows must be a bounded array");
  }

  const ids = new Set();
  let highestOrdinal = 0;
  const windows = value.windows.map((windowState) => {
    if (!windowState || typeof windowState !== "object" || Array.isArray(windowState)) {
      throw new TypeError("Workspace window must be an object");
    }
    if (!WINDOW_ID_RE.test(windowState.id ?? "") || ids.has(windowState.id)) {
      throw new TypeError("Workspace window id is invalid or duplicated");
    }
    if (!APP_ID_RE.test(windowState.appId ?? "")) {
      throw new TypeError("Workspace app id is invalid");
    }
    if (typeof windowState.minimized !== "boolean" || typeof windowState.maximized !== "boolean") {
      throw new TypeError("Workspace window flags must be boolean");
    }
    const placementOrdinal = positiveOrdinal(windowState.placementOrdinal, "placementOrdinal");
    highestOrdinal = Math.max(highestOrdinal, placementOrdinal);
    ids.add(windowState.id);
    return Object.freeze({
      id: windowState.id,
      appId: windowState.appId,
      minimized: windowState.minimized,
      maximized: windowState.maximized,
      placementOrdinal,
      positionX: optionalCoordinate(windowState.positionX, "positionX"),
      positionY: optionalCoordinate(windowState.positionY, "positionY"),
    });
  });

  const activeWindowId = value.activeWindowId ?? null;
  if (activeWindowId !== null && (typeof activeWindowId !== "string" || !ids.has(activeWindowId))) {
    throw new TypeError("Workspace activeWindowId must reference a persisted window");
  }
  const nextWindowOrdinal = positiveOrdinal(value.nextWindowOrdinal ?? 1, "nextWindowOrdinal");
  if (nextWindowOrdinal <= highestOrdinal) {
    throw new TypeError("Workspace nextWindowOrdinal must be greater than persisted ordinals");
  }

  return Object.freeze({
    windows: Object.freeze(windows),
    activeWindowId,
    nextWindowOrdinal,
  });
}

export function assertWorkspaceStore(store) {
  if (!store || typeof store !== "object" || store.schema !== WORKSPACE_STORE_SCHEMA) {
    throw new TypeError("A compatible workspace store is required");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Workspace store must implement load() and save(snapshot)");
  }
  validateWorkspaceRecord(store.load());
  return store;
}
