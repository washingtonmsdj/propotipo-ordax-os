export const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";

export function validateComponentRuntime(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component runtime must be an object");
  }
  if (value.schema !== COMPONENT_RUNTIME_SCHEMA) {
    throw new TypeError("Unsupported component runtime schema");
  }
  if (typeof value.componentId !== "string" || !value.componentId) {
    throw new TypeError("Component runtime componentId is required");
  }
  if (typeof value.version !== "string" || !value.version) {
    throw new TypeError("Component runtime version is required");
  }
  if (typeof value.mount !== "function") {
    throw new TypeError("Component runtime must implement mount(context)");
  }
  if (expected.componentId && value.componentId !== expected.componentId) {
    throw new TypeError(`Component runtime id mismatch: expected ${expected.componentId}`);
  }
  if (expected.version && value.version !== expected.version) {
    throw new TypeError(
      `Component runtime version mismatch: expected ${expected.version}, received ${value.version}`,
    );
  }
  return value;
}

export function validateMountedComponent(value, componentId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Mounted component ${componentId} must return an object`);
  }
  if (typeof value.destroy !== "function") {
    throw new TypeError(`Mounted component ${componentId} must implement destroy()`);
  }
  return value;
}


export async function probeMountedComponentHealth(value, componentId) {
  const mounted = validateMountedComponent(value, componentId);
  if (typeof mounted.probeHealth !== "function") {
    throw new TypeError(
      `Mounted component ${componentId} must implement probeHealth() before pending promotion`,
    );
  }
  const healthy = await mounted.probeHealth();
  if (healthy !== true) {
    throw new Error(`Mounted component ${componentId} did not pass its pending health probe`);
  }
  return true;
}
