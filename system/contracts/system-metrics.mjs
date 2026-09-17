export const SYSTEM_METRICS_SCHEMA = "ordax.system-metrics/1";

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`System metrics ${field} must be a non-negative safe integer`);
  }
  return value;
}

export function validateSystemMetricsSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("System metrics snapshot must be an object");
  }

  const snapshot = {
    uptimeSeconds: nonNegativeInteger(value.uptimeSeconds, "uptimeSeconds"),
    memoryTotalBytes: nonNegativeInteger(value.memoryTotalBytes, "memoryTotalBytes"),
    memoryAvailableBytes: nonNegativeInteger(value.memoryAvailableBytes, "memoryAvailableBytes"),
    userStorageTotalBytes: nonNegativeInteger(value.userStorageTotalBytes, "userStorageTotalBytes"),
    userStorageFreeBytes: nonNegativeInteger(value.userStorageFreeBytes, "userStorageFreeBytes"),
  };

  if (snapshot.memoryAvailableBytes > snapshot.memoryTotalBytes) {
    throw new TypeError("System metrics available memory cannot exceed total memory");
  }
  if (snapshot.userStorageFreeBytes > snapshot.userStorageTotalBytes) {
    throw new TypeError("System metrics free user storage cannot exceed total user storage");
  }

  return Object.freeze(snapshot);
}

export function assertSystemMetricsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SYSTEM_METRICS_SCHEMA) {
    throw new TypeError("A compatible system-metrics port is required");
  }
  if (typeof port.read !== "function") {
    throw new TypeError("System-metrics port must implement read()");
  }
  return port;
}
