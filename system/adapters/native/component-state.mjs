import {
  COMPONENT_STATE_STORE_SCHEMA,
  assertComponentStateStore,
  validateComponentState,
} from "../../contracts/component-state-store.mjs";

const COMPONENT_STATE_ENDPOINT = "/__ordax/native/component-state";

export async function createNativeComponentStateStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native component state store requires window.fetch");
  }

  let memory = null;
  const response = await windowRef.fetch(COMPONENT_STATE_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Native component state persistence unavailable: ${response.status}`);
  }
  const initial = await response.json();
  if (initial?.payload !== null && initial?.payload !== undefined) {
    memory = validateComponentState(JSON.parse(initial.payload));
  }

  let persistQueue = Promise.resolve();
  const persist = async (state) => {
    const response = await windowRef.fetch(COMPONENT_STATE_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(state) }),
    });
    if (!response.ok) {
      throw new Error(`Native component state persistence failed: ${response.status}`);
    }
  };

  const store = {
    schema: COMPONENT_STATE_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(state) {
      const validated = validateComponentState(state);
      memory = validated;
      persistQueue = persistQueue.then(() => persist(validated)).catch(() => false);
      return true;
    },
  };

  assertComponentStateStore(store);
  return Object.freeze(store);
}
