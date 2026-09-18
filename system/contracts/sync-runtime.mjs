export const SYNC_RUNTIME_SCHEMA = "ordax.sync-runtime/1";

const TRANSPORT_STATES = new Set(["host-required", "available"]);
const CONTINUITY_STATES = new Set(["not-active", "active"]);
const QUEUE_PERSISTENCE_STATES = new Set(["session", "device"]);

export function validateSyncRuntimeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Sync runtime snapshot must be an object");
  }
  if (!TRANSPORT_STATES.has(value.transport)) {
    throw new TypeError(`Unsupported sync transport state: ${String(value.transport)}`);
  }
  if (!CONTINUITY_STATES.has(value.accountContinuity)) {
    throw new TypeError(`Unsupported account continuity state: ${String(value.accountContinuity)}`);
  }
  if (!Number.isSafeInteger(value.pendingMutationCount) || value.pendingMutationCount < 0) {
    throw new TypeError("Sync pendingMutationCount must be a non-negative safe integer");
  }
  if (!QUEUE_PERSISTENCE_STATES.has(value.queuePersistence)) {
    throw new TypeError("Sync queuePersistence must be session or device");
  }
  if (
    !Array.isArray(value.trackedDataClasses) ||
    value.trackedDataClasses.some((item) => typeof item !== "string" || !item) ||
    new Set(value.trackedDataClasses).size !== value.trackedDataClasses.length
  ) {
    throw new TypeError("Sync trackedDataClasses must contain unique non-empty ids");
  }
  return Object.freeze({
    transport: value.transport,
    accountContinuity: value.accountContinuity,
    pendingMutationCount: value.pendingMutationCount,
    queuePersistence: value.queuePersistence,
    trackedDataClasses: Object.freeze([...value.trackedDataClasses]),
  });
}

export function assertSyncRuntimePort(port) {
  if (!port || typeof port !== "object" || port.schema !== SYNC_RUNTIME_SCHEMA) {
    throw new TypeError("A compatible sync-runtime port is required");
  }
  if (typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("Sync-runtime port must implement getSnapshot() and subscribe()");
  }
  validateSyncRuntimeSnapshot(port.getSnapshot());
  return port;
}
