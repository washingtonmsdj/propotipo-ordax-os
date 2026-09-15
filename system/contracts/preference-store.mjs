export const PREFERENCE_STORE_SCHEMA = "ordax.preference-store/1";

const PREFERENCE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export function validatePreferenceRecord(value) {
  if (value === undefined || value === null) {
    return Object.freeze({});
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Preference store payload must be an object");
  }

  const record = {};
  for (const [preferenceId, preferenceValue] of Object.entries(value)) {
    if (!PREFERENCE_ID.test(preferenceId)) {
      throw new TypeError(`Invalid preference id in store: ${preferenceId}`);
    }
    if (!isScalar(preferenceValue)) {
      throw new TypeError(`Preference store value must be scalar: ${preferenceId}`);
    }
    record[preferenceId] = preferenceValue;
  }
  return Object.freeze(record);
}

export function assertPreferenceStore(store) {
  if (!store || typeof store !== "object") {
    throw new TypeError("Preference store is required");
  }
  if (store.schema !== PREFERENCE_STORE_SCHEMA) {
    throw new TypeError(`Unsupported preference store schema: ${String(store.schema)}`);
  }
  if (typeof store.load !== "function") {
    throw new TypeError("Preference store must implement load()");
  }
  if (typeof store.save !== "function") {
    throw new TypeError("Preference store must implement save(snapshot)");
  }
  return store;
}
