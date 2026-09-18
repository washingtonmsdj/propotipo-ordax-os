import { appearancePreference } from "../preferences/appearance.mjs";

export const SYNC_OBJECT_SCHEMA = "ordax.sync-object/1";
export const SYNC_MUTATION_SCHEMA = "ordax.sync-mutation/1";
export const APPEARANCE_SYNC_OBJECT_ID = "appearance/theme";
export const APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION = 1;

export const SYNC_CORE_STATUS = Object.freeze({
  protocolCore: "implemented",
  offlineMutationQueue: "implemented",
  preferenceBridge: "implemented",
  identity: "host-required",
  transport: "host-required",
  accountContinuity: "not-active",
});

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function requireRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new TypeError("Sync mutation idempotencyKey must be 8-128 safe characters");
  }
  return value;
}

function freezeAppearancePayload(theme) {
  return Object.freeze({ theme: appearancePreference.validate(theme) });
}

export function createAppearanceSyncObject({ theme, serverRevision }) {
  return Object.freeze({
    $schema: SYNC_OBJECT_SCHEMA,
    objectId: APPEARANCE_SYNC_OBJECT_ID,
    dataClass: "appearance",
    objectSchemaVersion: APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION,
    serverRevision: requireRevision(serverRevision, "serverRevision"),
    tombstone: false,
    payload: freezeAppearancePayload(theme),
  });
}

export function createAppearanceTombstone({ serverRevision }) {
  return Object.freeze({
    $schema: SYNC_OBJECT_SCHEMA,
    objectId: APPEARANCE_SYNC_OBJECT_ID,
    dataClass: "appearance",
    objectSchemaVersion: APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION,
    serverRevision: requireRevision(serverRevision, "serverRevision"),
    tombstone: true,
    payload: null,
  });
}

export function validateAppearanceSyncObject(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Appearance sync object must be an object");
  }
  if (value.$schema !== SYNC_OBJECT_SCHEMA) {
    throw new TypeError(`Unsupported sync object schema: ${String(value.$schema)}`);
  }
  if (value.objectId !== APPEARANCE_SYNC_OBJECT_ID || value.dataClass !== "appearance") {
    throw new TypeError("Sync object is not the canonical appearance object");
  }
  if (value.objectSchemaVersion !== APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported appearance object schema version: ${String(value.objectSchemaVersion)}`);
  }
  const serverRevision = requireRevision(value.serverRevision, "serverRevision");
  if (value.tombstone === true) {
    if (value.payload !== null) {
      throw new TypeError("Appearance tombstone payload must be null");
    }
    return createAppearanceTombstone({ serverRevision });
  }
  if (value.tombstone !== false || !value.payload || typeof value.payload !== "object") {
    throw new TypeError("Appearance sync object must contain a payload or explicit tombstone");
  }
  return createAppearanceSyncObject({
    theme: value.payload.theme,
    serverRevision,
  });
}

function equivalentAppearanceState(left, right) {
  if (left.tombstone !== right.tombstone) return false;
  if (left.tombstone) return true;
  return left.payload.theme === right.payload.theme;
}

export function resolveAppearanceSyncConflict(leftValue, rightValue) {
  const left = validateAppearanceSyncObject(leftValue);
  const right = validateAppearanceSyncObject(rightValue);
  if (left.serverRevision > right.serverRevision) return left;
  if (right.serverRevision > left.serverRevision) return right;
  if (equivalentAppearanceState(left, right)) return left;
  throw new Error("Divergent appearance state has the same server revision");
}

export function createAppearanceSyncMutation({ theme, baseServerRevision, idempotencyKey }) {
  return Object.freeze({
    $schema: SYNC_MUTATION_SCHEMA,
    operation: "upsert",
    objectId: APPEARANCE_SYNC_OBJECT_ID,
    dataClass: "appearance",
    objectSchemaVersion: APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION,
    baseServerRevision: requireRevision(baseServerRevision, "baseServerRevision"),
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    payload: freezeAppearancePayload(theme),
  });
}

export function validateAppearanceSyncMutation(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Appearance sync mutation must be an object");
  }
  if (value.$schema !== SYNC_MUTATION_SCHEMA || value.operation !== "upsert") {
    throw new TypeError("Unsupported appearance sync mutation");
  }
  if (value.objectId !== APPEARANCE_SYNC_OBJECT_ID || value.dataClass !== "appearance") {
    throw new TypeError("Mutation does not target the canonical appearance object");
  }
  if (value.objectSchemaVersion !== APPEARANCE_SYNC_OBJECT_SCHEMA_VERSION) {
    throw new TypeError("Unsupported appearance mutation schema version");
  }
  if (!value.payload || typeof value.payload !== "object") {
    throw new TypeError("Appearance sync mutation payload is required");
  }
  return createAppearanceSyncMutation({
    theme: value.payload.theme,
    baseServerRevision: value.baseServerRevision,
    idempotencyKey: value.idempotencyKey,
  });
}

function sameMutation(left, right) {
  return (
    left.objectId === right.objectId &&
    left.baseServerRevision === right.baseServerRevision &&
    left.payload.theme === right.payload.theme
  );
}

export function createSyncMutationQueue(initialMutations = []) {
  if (!Array.isArray(initialMutations)) {
    throw new TypeError("Sync mutation queue seed must be an array");
  }
  let mutations = [];

  const enqueue = (value) => {
    const mutation = validateAppearanceSyncMutation(value);
    const existing = mutations.find((item) => item.idempotencyKey === mutation.idempotencyKey);
    if (existing) {
      if (!sameMutation(existing, mutation)) {
        throw new Error("Idempotency key was reused for a different mutation");
      }
      return existing;
    }
    mutations = [...mutations, mutation];
    return mutation;
  };

  for (const mutation of initialMutations) enqueue(mutation);

  return Object.freeze({
    enqueue,
    acknowledge(idempotencyKey) {
      requireIdempotencyKey(idempotencyKey);
      const next = mutations.filter((item) => item.idempotencyKey !== idempotencyKey);
      const removed = next.length !== mutations.length;
      mutations = next;
      return removed;
    },
    snapshot() {
      return Object.freeze([...mutations]);
    },
  });
}
