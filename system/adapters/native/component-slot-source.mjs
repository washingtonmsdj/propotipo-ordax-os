import {
  COMPONENT_SLOT_SOURCE_SCHEMA,
  assertComponentSlotSource,
  validateComponentSlotRequest,
} from "../../contracts/component-slot-source.mjs";

const COMPONENT_SLOT_PREFIX = "/__ordax/native/component-slot/";

function nativeSurfaceOrigin(windowRef) {
  const href = windowRef?.location?.href;
  if (typeof href !== "string" || !href) {
    throw new TypeError("Native component slot source requires window.location.href");
  }
  const location = new URL(href);
  if (
    location.protocol !== "http:"
    || location.hostname !== "127.0.0.1"
    || location.username
    || location.password
  ) {
    throw new TypeError("Native component slots require the canonical loopback Surface origin");
  }
  return location.origin;
}

export function createNativeComponentSlotSource(windowRef = globalThis.window) {
  const origin = nativeSurfaceOrigin(windowRef);
  const source = {
    schema: COMPONENT_SLOT_SOURCE_SCHEMA,
    runtimeUrl(componentId, version) {
      const request = validateComponentSlotRequest(componentId, version);
      const url = new URL(
        `${COMPONENT_SLOT_PREFIX}${request.componentId}/${request.version}/${request.runtimePath}`,
        `${origin}/`,
      );
      if (url.origin !== origin) {
        throw new TypeError("Native component slot URL escaped the Surface origin");
      }
      return url.href;
    },
  };
  return Object.freeze(assertComponentSlotSource(source));
}
