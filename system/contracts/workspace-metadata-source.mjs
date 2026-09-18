import { MAX_WORKSPACE_AREAS } from "./workspace-store.mjs";

export const WORKSPACE_METADATA_SOURCE_SCHEMA = "ordax.workspace-metadata-source/1";
export const WORKSPACE_METADATA_SCHEMA = "ordax.workspace-metadata/1";

const AREA_ID_RE = /^area-[1-9][0-9]*$/;
const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const MAX_APPS_PER_AREA = 32;

function positiveOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Workspace metadata area ordinal must be a positive safe integer");
  }
  return value;
}

export function validateWorkspaceMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workspace metadata must be an object");
  }
  if (value.$schema !== WORKSPACE_METADATA_SCHEMA) {
    throw new TypeError(`Unsupported workspace metadata schema: ${String(value.$schema)}`);
  }
  if (
    !Array.isArray(value.areas) ||
    value.areas.length < 1 ||
    value.areas.length > MAX_WORKSPACE_AREAS
  ) {
    throw new TypeError("Workspace metadata areas must be a non-empty bounded array");
  }

  const ids = new Set();
  const ordinals = new Set();
  const areas = value.areas.map((area) => {
    if (!area || typeof area !== "object" || Array.isArray(area)) {
      throw new TypeError("Workspace metadata area must be an object");
    }
    if (!AREA_ID_RE.test(area.id ?? "") || ids.has(area.id)) {
      throw new TypeError("Workspace metadata area id is invalid or duplicated");
    }
    const ordinal = positiveOrdinal(area.ordinal);
    if (area.id !== `area-${ordinal}` || ordinals.has(ordinal)) {
      throw new TypeError("Workspace metadata area id and ordinal must align");
    }
    if (
      !Array.isArray(area.appIds) ||
      area.appIds.length > MAX_APPS_PER_AREA ||
      area.appIds.some((appId) => typeof appId !== "string" || !APP_ID_RE.test(appId))
    ) {
      throw new TypeError("Workspace metadata app ids must be a bounded valid array");
    }
    ids.add(area.id);
    ordinals.add(ordinal);
    return Object.freeze({
      id: area.id,
      ordinal,
      appIds: Object.freeze([...area.appIds]),
    });
  });

  if (typeof value.activeAreaId !== "string" || !ids.has(value.activeAreaId)) {
    throw new TypeError("Workspace metadata activeAreaId must reference an area");
  }

  return Object.freeze({
    $schema: WORKSPACE_METADATA_SCHEMA,
    activeAreaId: value.activeAreaId,
    areas: Object.freeze(areas),
  });
}

export function assertWorkspaceMetadataSource(port) {
  if (!port || typeof port !== "object" || port.schema !== WORKSPACE_METADATA_SOURCE_SCHEMA) {
    throw new TypeError("A compatible workspace-metadata-source port is required");
  }
  if (typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("Workspace metadata source must implement getSnapshot() and subscribe()");
  }
  validateWorkspaceMetadata(port.getSnapshot());
  return port;
}
