export const WORKSPACE_STORE_SCHEMA = "ordax.workspace-store/2";
export const LEGACY_WORKSPACE_STORE_SCHEMA = "ordax.workspace-store/1";
export const MAX_WORKSPACE_AREAS = 8;

const WINDOW_ID_RE = /^[a-z][a-z0-9-]*(?::[1-9][0-9]*)?$/;
const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const AREA_ID_RE = /^area-[1-9][0-9]*$/;
const MAX_WINDOWS = 32;
const MAX_COORDINATE = 1_000_000;
const MAX_TARGET_LENGTH = 4096;

export function validateWorkspaceTarget(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_TARGET_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError("Workspace target must be null or a bounded string");
  }
  return value;
}

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

function validateWindowRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workspace window must be an object");
  }
  if (!WINDOW_ID_RE.test(value.id ?? "")) {
    throw new TypeError("Workspace window id is invalid");
  }
  if (!APP_ID_RE.test(value.appId ?? "")) {
    throw new TypeError("Workspace app id is invalid");
  }
  if (typeof value.minimized !== "boolean" || typeof value.maximized !== "boolean") {
    throw new TypeError("Workspace window flags must be boolean");
  }
  return Object.freeze({
    id: value.id,
    appId: value.appId,
    minimized: value.minimized,
    maximized: value.maximized,
    placementOrdinal: positiveOrdinal(value.placementOrdinal, "placementOrdinal"),
    positionX: optionalCoordinate(value.positionX, "positionX"),
    positionY: optionalCoordinate(value.positionY, "positionY"),
    target: validateWorkspaceTarget(value.target),
  });
}

function validateWindowSet(value) {
  if (!Array.isArray(value.windows) || value.windows.length > MAX_WINDOWS) {
    throw new TypeError("Workspace windows must be a bounded array");
  }
  const ids = new Set();
  let highestOrdinal = 0;
  const windows = value.windows.map((windowState) => {
    const windowRecord = validateWindowRecord(windowState);
    if (ids.has(windowRecord.id)) {
      throw new TypeError("Workspace window id is duplicated");
    }
    ids.add(windowRecord.id);
    highestOrdinal = Math.max(highestOrdinal, windowRecord.placementOrdinal);
    return windowRecord;
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

export function validateLegacyWorkspaceRecord(value) {
  if (value === undefined || value === null) {
    value = { windows: [], activeWindowId: null, nextWindowOrdinal: 1 };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Legacy workspace payload must be an object");
  }
  return validateWindowSet(value);
}

function emptyArea(ordinal) {
  return Object.freeze({
    id: `area-${ordinal}`,
    ordinal,
    windows: Object.freeze([]),
    activeWindowId: null,
    nextWindowOrdinal: 1,
  });
}

export function createDefaultWorkspaceRecord() {
  return Object.freeze({
    activeAreaId: "area-1",
    nextAreaOrdinal: 3,
    areas: Object.freeze([emptyArea(1), emptyArea(2)]),
  });
}

export function migrateLegacyWorkspaceRecord(value) {
  const legacy = validateLegacyWorkspaceRecord(value);
  return validateWorkspaceRecord({
    activeAreaId: "area-1",
    nextAreaOrdinal: 3,
    areas: [
      {
        id: "area-1",
        ordinal: 1,
        windows: legacy.windows,
        activeWindowId: legacy.activeWindowId,
        nextWindowOrdinal: legacy.nextWindowOrdinal,
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

export function validateWorkspaceRecord(value) {
  if (value === undefined || value === null) return createDefaultWorkspaceRecord();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workspace store payload must be an object");
  }
  if (!Array.isArray(value.areas) || value.areas.length < 1 || value.areas.length > MAX_WORKSPACE_AREAS) {
    throw new TypeError("Workspace areas must be a non-empty bounded array");
  }

  const ids = new Set();
  const ordinals = new Set();
  let highestAreaOrdinal = 0;
  const areas = value.areas.map((area) => {
    if (!area || typeof area !== "object" || Array.isArray(area)) {
      throw new TypeError("Workspace area must be an object");
    }
    if (!AREA_ID_RE.test(area.id ?? "") || ids.has(area.id)) {
      throw new TypeError("Workspace area id is invalid or duplicated");
    }
    const ordinal = positiveOrdinal(area.ordinal, "area ordinal");
    if (area.id !== `area-${ordinal}` || ordinals.has(ordinal)) {
      throw new TypeError("Workspace area id and ordinal must be unique and aligned");
    }
    const windows = validateWindowSet(area);
    ids.add(area.id);
    ordinals.add(ordinal);
    highestAreaOrdinal = Math.max(highestAreaOrdinal, ordinal);
    return Object.freeze({ id: area.id, ordinal, ...windows });
  });

  const activeAreaId = value.activeAreaId;
  if (typeof activeAreaId !== "string" || !ids.has(activeAreaId)) {
    throw new TypeError("Workspace activeAreaId must reference a persisted area");
  }
  const nextAreaOrdinal = positiveOrdinal(value.nextAreaOrdinal, "nextAreaOrdinal");
  if (nextAreaOrdinal <= highestAreaOrdinal) {
    throw new TypeError("Workspace nextAreaOrdinal must be greater than persisted area ordinals");
  }

  return Object.freeze({
    activeAreaId,
    nextAreaOrdinal,
    areas: Object.freeze(areas),
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
