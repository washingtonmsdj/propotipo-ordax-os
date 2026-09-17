import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

const WORKSPACE_ENDPOINT = "/__ordax/native/workspace";

export async function createNativeWorkspaceStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native workspace store requires window.fetch");
  }

  let memory = validateWorkspaceRecord(null);
  const response = await windowRef.fetch(WORKSPACE_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Native workspace load failed: ${response.status}`);
  }
  memory = validateWorkspaceRecord(await response.json());
  let pendingWrite = Promise.resolve();

  const persist = (snapshot) => {
    pendingWrite = pendingWrite
      .catch(() => {})
      .then(async () => {
        const writeResponse = await windowRef.fetch(WORKSPACE_ENDPOINT, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        if (!writeResponse.ok) {
          throw new Error(`Native workspace save failed: ${writeResponse.status}`);
        }
      });
  };

  const store = {
    schema: WORKSPACE_STORE_SCHEMA,
    load() {
      return memory;
    },
    save(snapshot) {
      memory = validateWorkspaceRecord(snapshot);
      persist(memory);
      return true;
    },
  };

  assertWorkspaceStore(store);
  return Object.freeze(store);
}
