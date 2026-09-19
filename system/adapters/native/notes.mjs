import {
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../contracts/notes-store.mjs";

const NOTES_ENDPOINT = "/__ordax/native/notes";

export async function createNativeNotesStore(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native notes store requires window.fetch");
  }

  let memory = null;
  const response = await windowRef.fetch(NOTES_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native notes persistence unavailable: ${response.status}`);
  const initial = await response.json();
  if (initial?.payload !== null && initial?.payload !== undefined) {
    memory = validateNotesSnapshot(JSON.parse(initial.payload));
  }

  let persistQueue = Promise.resolve();
  const persist = async (snapshot) => {
    const next = await windowRef.fetch(NOTES_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(snapshot) }),
    });
    if (!next.ok) throw new Error(`Native notes persistence failed: ${next.status}`);
  };

  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(snapshot) {
      const validated = validateNotesSnapshot(snapshot);
      memory = validated;
      persistQueue = persistQueue.then(() => persist(validated)).catch(() => false);
      return true;
    },
  };

  assertNotesStore(store);
  return Object.freeze(store);
}
