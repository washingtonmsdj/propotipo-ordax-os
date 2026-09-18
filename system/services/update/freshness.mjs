import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";

// Freshness describes the age of the published observation only. A stale result is
// not proof that the supervisor process is dead, and a fresh result is not a health
// verdict. Hosts with a deliberately slower cadence must pass their own max age.
export const DEFAULT_UPDATE_STATE_MAX_AGE_SECONDS = 90;
export const MAX_UPDATE_STATE_MAX_AGE_SECONDS = 3600;
export const UPDATE_CLOCK_SKEW_TOLERANCE_SECONDS = 5;

const FRESHNESS_STATES = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  UNKNOWN: "unknown",
});

function validateNowMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Update freshness nowMs must be a non-negative finite number");
  }
  return value;
}

export function validateUpdateStateMaxAgeSeconds(value) {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_UPDATE_STATE_MAX_AGE_SECONDS
  ) {
    throw new TypeError(
      `Update freshness max age must be an integer between 1 and ${MAX_UPDATE_STATE_MAX_AGE_SECONDS} seconds`,
    );
  }
  return value;
}

function unknownFreshness(reason, maxAgeSeconds) {
  return Object.freeze({
    state: FRESHNESS_STATES.UNKNOWN,
    reason,
    checkedAt: null,
    ageSeconds: null,
    maxAgeSeconds,
  });
}

export function evaluateUpdateStateFreshness(
  value,
  {
    nowMs = Date.now(),
    maxAgeSeconds = DEFAULT_UPDATE_STATE_MAX_AGE_SECONDS,
  } = {},
) {
  const snapshot = validateUpdateStatusSnapshot(value);
  const now = validateNowMs(nowMs);
  const maxAge = validateUpdateStateMaxAgeSeconds(maxAgeSeconds);

  if (!snapshot.checkedAt || snapshot.checkedAt === "unknown") {
    return unknownFreshness("missing-checked-at", maxAge);
  }

  const checkedAtMs = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return unknownFreshness("invalid-checked-at", maxAge);
  }

  const futureSkewMs = checkedAtMs - now;
  if (futureSkewMs > UPDATE_CLOCK_SKEW_TOLERANCE_SECONDS * 1000) {
    return unknownFreshness("clock-skew", maxAge);
  }

  const ageSeconds = Math.max(0, Math.floor((now - checkedAtMs) / 1000));
  return Object.freeze({
    state: ageSeconds <= maxAge ? FRESHNESS_STATES.FRESH : FRESHNESS_STATES.STALE,
    reason: "",
    checkedAt: snapshot.checkedAt,
    ageSeconds,
    maxAgeSeconds: maxAge,
  });
}
