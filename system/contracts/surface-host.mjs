export const SURFACE_HOST_SCHEMA = "ordax.surface-host/1";

const CONNECTIVITY = new Set(["online", "offline", "unknown"]);

export function validateSurfaceSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Surface host snapshot must be an object");
  }

  const capabilityIds = Array.isArray(value.capabilityIds) ? value.capabilityIds : [];
  if (capabilityIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new TypeError("Surface capability IDs must be non-empty strings");
  }
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new TypeError("Surface capability IDs must be unique");
  }

  const connectivity = value.connectivity ?? "unknown";
  if (!CONNECTIVITY.has(connectivity)) {
    throw new TypeError(`Unsupported Surface connectivity state: ${connectivity}`);
  }

  return Object.freeze({
    capabilityIds: Object.freeze([...capabilityIds]),
    connectivity,
  });
}

export function assertSurfaceHost(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("Surface host is required");
  }
  if (host.schema !== SURFACE_HOST_SCHEMA) {
    throw new TypeError(`Unsupported Surface host schema: ${String(host.schema)}`);
  }
  if (typeof host.getSnapshot !== "function") {
    throw new TypeError("Surface host must implement getSnapshot()");
  }
  if (typeof host.subscribe !== "function") {
    throw new TypeError("Surface host must implement subscribe(listener)");
  }

  validateSurfaceSnapshot(host.getSnapshot());
  return host;
}
