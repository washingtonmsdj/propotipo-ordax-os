import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const COMPONENT_SLOT_SOURCE_SCHEMA = "ordax.component-slot-source/1";

export function componentRuntimePath(componentId) {
  const id = validateComponentId(componentId);
  return `system/components/${id}/runtime.mjs`;
}

export function assertComponentSlotSource(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== COMPONENT_SLOT_SOURCE_SCHEMA
  ) {
    throw new TypeError("A compatible component slot source is required");
  }
  if (typeof port.runtimeUrl !== "function") {
    throw new TypeError("Component slot source must implement runtimeUrl(componentId, version)");
  }
  return port;
}

export function validateComponentSlotRequest(componentId, version) {
  return Object.freeze({
    componentId: validateComponentId(componentId),
    version: validateComponentVersion(version),
    runtimePath: componentRuntimePath(componentId),
  });
}
