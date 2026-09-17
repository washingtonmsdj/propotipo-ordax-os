export const APP_ACTIVATION_SCHEMA = "ordax.app-activation/1";

const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const MAX_TARGET_LENGTH = 4096;

export function validateAppActivation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App activation must be an object");
  }
  if (!APP_ID_RE.test(value.appId ?? "")) {
    throw new TypeError("App activation appId is invalid");
  }
  const target = value.target ?? null;
  if (
    target !== null &&
    (
      typeof target !== "string" ||
      target.length === 0 ||
      target.length > MAX_TARGET_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(target)
    )
  ) {
    throw new TypeError("App activation target is invalid");
  }
  return Object.freeze({ appId: value.appId, target });
}

export function assertAppActivationPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APP_ACTIVATION_SCHEMA) {
    throw new TypeError("A compatible app-activation port is required");
  }
  if (typeof port.publish !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("App-activation port must implement publish() and subscribe()");
  }
  return port;
}
