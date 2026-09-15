import { appearancePreference } from "./appearance.mjs";

const DEFINITIONS = Object.freeze([appearancePreference]);
const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

if (BY_ID.size !== DEFINITIONS.length) {
  throw new TypeError("Preference ids must be unique");
}

export function listPreferenceDefinitions() {
  return DEFINITIONS;
}

export function getPreferenceDefinition(preferenceId) {
  return BY_ID.get(preferenceId) ?? null;
}

export function createPreferenceSnapshot(seed = {}) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    throw new TypeError("Preference seed must be an object");
  }

  const snapshot = {};
  for (const definition of DEFINITIONS) {
    const candidate = Object.prototype.hasOwnProperty.call(seed, definition.id)
      ? seed[definition.id]
      : definition.defaultValue;
    snapshot[definition.id] = definition.validate(candidate);
  }
  return Object.freeze(snapshot);
}

export function recoverPreferenceSnapshot(seed = {}) {
  const source = seed && typeof seed === "object" && !Array.isArray(seed) ? seed : {};
  const snapshot = {};
  for (const definition of DEFINITIONS) {
    const candidate = Object.prototype.hasOwnProperty.call(source, definition.id)
      ? source[definition.id]
      : definition.defaultValue;
    try {
      snapshot[definition.id] = definition.validate(candidate);
    } catch {
      snapshot[definition.id] = definition.defaultValue;
    }
  }
  return Object.freeze(snapshot);
}

export function setPreferenceValue(snapshot, preferenceId, value) {
  const definition = getPreferenceDefinition(preferenceId);
  if (!definition) return snapshot;
  const validated = definition.validate(value);
  if (snapshot[preferenceId] === validated) return snapshot;
  return Object.freeze({ ...snapshot, [preferenceId]: validated });
}
