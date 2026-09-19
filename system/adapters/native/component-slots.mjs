import {
  COMPONENT_SLOTS_SCHEMA,
  validateComponentSlotId,
  validateComponentSlotSnapshot,
  validateComponentSlotVersion,
} from "../../contracts/component-slots.mjs";

const SESSION_ENDPOINT = "/__ordax/native/session";
const SLOT_ENDPOINT = "/__ordax/native/component-slot";

export async function createNativeComponentSlots(windowObject = globalThis.window) {
  if (!windowObject || typeof windowObject.fetch !== "function") {
    throw new TypeError("Native component slots require window.fetch");
  }

  const sessionResponse = await windowObject.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!sessionResponse.ok) {
    throw new Error(`Native component slot session unavailable: ${sessionResponse.status}`);
  }
  const session = await sessionResponse.json();
  const token = session?.componentSlotToken;
  if (typeof token !== "string" || token.length < 24) {
    throw new TypeError("Native component slot token is invalid");
  }

  const read = async (componentId) => {
    const id = validateComponentSlotId(componentId);
    const response = await windowObject.fetch(
      `${SLOT_ENDPOINT}?component=${encodeURIComponent(id)}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      },
    );
    if (!response.ok) {
      throw new Error(`Native component slot snapshot failed: ${response.status}`);
    }
    return validateComponentSlotSnapshot(await response.json());
  };

  const mutate = async (payload) => {
    const response = await windowObject.fetch(SLOT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-OrdaX-Component-Slot-Token": token,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Native component slot action failed: ${response.status}`);
    }
    return validateComponentSlotSnapshot(await response.json());
  };

  return Object.freeze({
    schema: COMPONENT_SLOTS_SCHEMA,
    getSnapshot(componentId) {
      return read(componentId);
    },
    prepare(componentId, version) {
      return mutate({
        action: "prepare",
        componentId: validateComponentSlotId(componentId),
        version: validateComponentSlotVersion(version),
      });
    },
    promote(componentId, version) {
      return mutate({
        action: "promote",
        componentId: validateComponentSlotId(componentId),
        version: validateComponentSlotVersion(version),
      });
    },
    reject(componentId, version) {
      return mutate({
        action: "reject",
        componentId: validateComponentSlotId(componentId),
        version: validateComponentSlotVersion(version),
      });
    },
    rollback(componentId) {
      return mutate({
        action: "rollback",
        componentId: validateComponentSlotId(componentId),
      });
    },
  });
}
