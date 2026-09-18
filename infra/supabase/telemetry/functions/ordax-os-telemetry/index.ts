import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 12 * 1024;
const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{7,127}$/;
const STATUS_RE = /^[a-z0-9-]{1,48}$/;
const DIAGNOSTIC_STAGE_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const DIAGNOSTIC_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const DIAGNOSTIC_SOURCE_RE = /^[A-Za-z0-9_.-]+\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$/;
const APPLY_MODES = new Set(["initial","none","reload","surface-restart","supervisor-restart"]);
const PHASES = new Set(["idle","checking","fetching","validating","activating","health-wait","rollback","blocked","error"]);
const SURFACE_STATES = new Set(["unknown","starting","running","fallback","stopped"]);
const RESCUE_ACTIONS = new Set(["none","noop","clear-rejected","retry-main"]);
const POWER_ACTIONS = new Set(["restart","shutdown"]);
const POWER_REQUEST_STATUSES = new Set(["pending","failed"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function optionalSha(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !SHA_RE.test(value)) throw new Error("invalid sha");
  return value;
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > max) throw new Error("invalid string");
  return value;
}

function optionalInteger(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error("invalid integer");
  return parsed;
}

function optionalNullableInteger(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error("invalid integer");
  return parsed;
}

function optionalBoolean(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "boolean") throw new Error("invalid boolean");
  return value;
}

function optionalDiagnosticStage(value: unknown) {
  const result = optionalString(value, 64);
  if (result && !DIAGNOSTIC_STAGE_RE.test(result)) throw new Error("invalid diagnostic stage");
  return result;
}

function optionalDiagnosticName(value: unknown) {
  const result = optionalString(value, 64);
  if (result && !DIAGNOSTIC_NAME_RE.test(result)) throw new Error("invalid diagnostic name");
  return result;
}

function optionalDiagnosticSource(value: unknown) {
  const result = optionalString(value, 96);
  if (result && !DIAGNOSTIC_SOURCE_RE.test(result)) throw new Error("invalid diagnostic source");
  return result;
}

function validate(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("payload must be object");
  const value = input as Record<string, unknown>;
  if (typeof value.deviceId !== "string" || !ID_RE.test(value.deviceId)) throw new Error("invalid deviceId");

  const updateStatus = optionalString(value.updateStatus, 48);
  if (updateStatus && !STATUS_RE.test(updateStatus)) throw new Error("invalid updateStatus");

  const applyMode = optionalString(value.applyMode, 32);
  if (applyMode && !APPLY_MODES.has(applyMode)) throw new Error("invalid applyMode");

  const phase = optionalString(value.phase, 32);
  if (phase && !PHASES.has(phase)) throw new Error("invalid phase");

  const surfaceState = optionalString(value.surfaceState, 32) || "unknown";
  if (!SURFACE_STATES.has(surfaceState)) throw new Error("invalid surfaceState");

  const rescueAction = optionalString(value.rescueAction, 32) || "none";
  if (!RESCUE_ACTIONS.has(rescueAction)) throw new Error("invalid rescueAction");

  const lastPowerAction = optionalString(value.lastPowerAction, 16);
  if (lastPowerAction && !POWER_ACTIONS.has(lastPowerAction)) throw new Error("invalid lastPowerAction");
  const lastPowerRequestStatus = optionalString(value.lastPowerRequestStatus, 16);
  if (lastPowerRequestStatus && !POWER_REQUEST_STATUSES.has(lastPowerRequestStatus)) {
    throw new Error("invalid lastPowerRequestStatus");
  }

  let rescueGeneration: number | null = null;
  if (value.rescueGeneration !== undefined && value.rescueGeneration !== null && value.rescueGeneration !== "") {
    rescueGeneration = Number(value.rescueGeneration);
    if (!Number.isSafeInteger(rescueGeneration) || rescueGeneration < 0) throw new Error("invalid rescueGeneration");
  }

  let supervisorStateEpoch: number | null = null;
  if (value.supervisorStateEpoch !== undefined && value.supervisorStateEpoch !== null && value.supervisorStateEpoch !== "") {
    supervisorStateEpoch = Number(value.supervisorStateEpoch);
    if (!Number.isSafeInteger(supervisorStateEpoch) || supervisorStateEpoch < 0) {
      throw new Error("invalid supervisorStateEpoch");
    }
  }

  let surfaceHeartbeatEpoch: number | null = null;
  if (value.surfaceHeartbeatEpoch !== undefined && value.surfaceHeartbeatEpoch !== null && value.surfaceHeartbeatEpoch !== "") {
    surfaceHeartbeatEpoch = Number(value.surfaceHeartbeatEpoch);
    if (!Number.isSafeInteger(surfaceHeartbeatEpoch) || surfaceHeartbeatEpoch < 0) {
      throw new Error("invalid surfaceHeartbeatEpoch");
    }
  }

  const relayVersion = value.relayVersion === undefined ? 1 : Number(value.relayVersion);
  if (!Number.isSafeInteger(relayVersion) || relayVersion < 1 || relayVersion > 1000) throw new Error("invalid relayVersion");

  return {
    deviceId: value.deviceId,
    sourceSha: optionalSha(value.sourceSha),
    runtimeSurfaceSha: optionalSha(value.runtimeSurfaceSha),
    deliveryNumber: optionalInteger(value.deliveryNumber, 10000000),
    bootRefreshRequired: optionalBoolean(value.bootRefreshRequired),
    targetSha: optionalSha(value.targetSha),
    remoteSha: optionalSha(value.remoteSha),
    updateStatus,
    phase,
    applyMode,
    supervisorCheckedAt: optionalString(value.supervisorCheckedAt, 64),
    supervisorStateEpoch,
    surfaceSourceSha: optionalSha(value.surfaceSourceSha),
    surfaceHeartbeatEpoch,
    attemptId: optionalString(value.attemptId, 96),
    rejectedSha: optionalSha(value.rejectedSha),
    healthySha: optionalSha(value.healthySha),
    lastAppliedSha: optionalSha(value.lastAppliedSha),
    lastAppliedAt: optionalString(value.lastAppliedAt, 64),
    stagedReleaseSha: optionalSha(value.stagedReleaseSha),
    lastApplyDurationSeconds: optionalInteger(value.lastApplyDurationSeconds, 3600),
    lastStageDurationSeconds: optionalInteger(value.lastStageDurationSeconds, 3600),
    rescueGeneration,
    rescueAction,
    surfaceState,
    bootId: optionalString(value.bootId, 128),
    lastError: optionalString(value.lastError, 1024),
    lastPowerAction,
    lastPowerRequestBootId: optionalString(value.lastPowerRequestBootId, 128),
    lastPowerRequestEpoch: optionalNullableInteger(value.lastPowerRequestEpoch, 9999999999),
    lastPowerRequestStatus,
    lastPowerRequestCrossedBoot: optionalBoolean(value.lastPowerRequestCrossedBoot),
    powerSupplyClassAvailable: optionalBoolean(value.powerSupplyClassAvailable),
    batteryDetected: optionalBoolean(value.batteryDetected),
    kernelSysrqRestartAvailable: optionalBoolean(value.kernelSysrqRestartAvailable),
    clientDiagnosticSha: optionalSha(value.clientDiagnosticSha),
    clientDiagnosticStage: optionalDiagnosticStage(value.clientDiagnosticStage),
    clientDiagnosticName: optionalDiagnosticName(value.clientDiagnosticName),
    clientDiagnosticSource: optionalDiagnosticSource(value.clientDiagnosticSource),
    clientDiagnosticEpoch: optionalNullableInteger(value.clientDiagnosticEpoch, 9999999999),
    relayVersion,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}";
  let publishableKey = "";
  try {
    publishableKey = JSON.parse(publishableKeysRaw)?.default || "";
  } catch {
    return json(500, { error: "relay_misconfigured" });
  }

  const providedKey = req.headers.get("apikey") || "";
  if (!publishableKey || providedKey !== publishableKey) {
    return json(401, { error: "invalid_publishable_key" });
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return json(400, { error: "invalid_body" });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }

  let payload: ReturnType<typeof validate>;
  try {
    payload = validate(JSON.parse(raw));
  } catch {
    return json(400, { error: "invalid_payload" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "{}";
  let secretKey = "";
  try {
    secretKey = JSON.parse(secretKeysRaw)?.default || "";
  } catch {
    return json(500, { error: "relay_misconfigured" });
  }
  if (!supabaseUrl || !secretKey) return json(500, { error: "relay_misconfigured" });

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("ordax_os_ingest_telemetry", { p_payload: payload });
  if (error) {
    console.error("ordax-os-relay ingest failed", error.message);
    return json(500, { error: "ingest_failed" });
  }

  return json(202, data ?? { ok: true });
});
