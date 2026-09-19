import {
  NOTIFICATION_STORE_SCHEMA,
  assertNotificationStore,
  validateNotificationPolicyPayload,
  validateNotificationStorePayload,
} from "../../contracts/notification-store.mjs";

const STORAGE_KEY = "ordax.native.notifications.v1";
const RECORD_SCHEMA = "ordax.native.notifications-record/1";
const POLICY_STORAGE_KEY = "ordax.native.notification-policy.v1";
const POLICY_RECORD_SCHEMA = "ordax.native.notification-policy-record/1";

function resolveStorage(windowRef) {
  try {
    const storage = windowRef?.localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
      return storage;
    }
  } catch {
    // Native browser policy may deny storage; the runtime remains session-scoped.
  }
  return null;
}

export function createNativeNotificationStore(windowRef = globalThis.window) {
  const storage = resolveStorage(windowRef);
  let memory = Object.freeze([]);
  let memoryPolicy = validateNotificationPolicyPayload(null);

  const store = {
    schema: NOTIFICATION_STORE_SCHEMA,
    scope: storage ? "device" : "session",
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return memory;
        const record = JSON.parse(raw);
        if (!record || record.schema !== RECORD_SCHEMA) {
          memory = Object.freeze([]);
          return memory;
        }
        memory = validateNotificationStorePayload(record.entries);
      } catch {
        memory = Object.freeze([]);
      }
      return memory;
    },
    save(entries) {
      memory = validateNotificationStorePayload(entries);
      if (!storage) return false;
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ schema: RECORD_SCHEMA, entries: memory }),
        );
        return true;
      } catch {
        return false;
      }
    },
    loadPolicy() {
      if (!storage) return memoryPolicy;
      try {
        const raw = storage.getItem(POLICY_STORAGE_KEY);
        if (raw === null) return memoryPolicy;
        const record = JSON.parse(raw);
        if (!record || record.schema !== POLICY_RECORD_SCHEMA) {
          memoryPolicy = validateNotificationPolicyPayload(null);
          return memoryPolicy;
        }
        memoryPolicy = validateNotificationPolicyPayload(record.policy);
      } catch {
        memoryPolicy = validateNotificationPolicyPayload(null);
      }
      return memoryPolicy;
    },
    savePolicy(policy) {
      memoryPolicy = validateNotificationPolicyPayload(policy);
      if (!storage) return false;
      try {
        storage.setItem(
          POLICY_STORAGE_KEY,
          JSON.stringify({ schema: POLICY_RECORD_SCHEMA, policy: memoryPolicy }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };

  assertNotificationStore(store);
  return Object.freeze(store);
}
