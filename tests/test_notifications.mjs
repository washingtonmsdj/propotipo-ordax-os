import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_NOTIFICATIONS,
  NOTIFICATIONS_SCHEMA,
  validateNotificationDraft,
} from "../system/contracts/notifications.mjs";
import { NOTIFICATION_STORE_SCHEMA } from "../system/contracts/notification-store.mjs";
import { UPDATE_STATUS_SCHEMA, validateUpdateStatusSnapshot } from "../system/contracts/update-status.mjs";
import { createNativeNotificationStore } from "../system/adapters/native/notifications.mjs";
import { createNotificationsRuntime } from "../system/services/notifications/runtime.mjs";
import { createUpdateNotificationBridge } from "../system/services/notifications/update-bridge.mjs";

function draft(overrides = {}) {
  return {
    sourceId: "system",
    level: "info",
    title: "Aviso",
    message: "Mensagem local",
    destination: { appId: "system", target: "updates" },
    ...overrides,
  };
}

function memoryStore({ failSave = false, failPolicySave = false } = {}) {
  let entries = [];
  let policy = { doNotDisturb: false };
  return {
    schema: NOTIFICATION_STORE_SCHEMA,
    scope: "device",
    load() {
      return entries;
    },
    save(next) {
      entries = next;
      return !failSave;
    },
    loadPolicy() {
      return policy;
    },
    savePolicy(next) {
      policy = next;
      return !failPolicySave;
    },
    snapshot() {
      return entries;
    },
    policySnapshot() {
      return policy;
    },
  };
}

function updateSnapshot(overrides = {}) {
  return validateUpdateStatusSnapshot({
    sourceSha: "aaaaaaaa",
    status: "running",
    phase: "idle",
    applyMode: "reload",
    attemptId: "attempt-1",
    targetSha: "",
    deliveryNumber: 12,
    bootRefreshRequired: false,
    ...overrides,
  });
}

function updatePort(initial) {
  let current = initial;
  const listeners = new Set();
  return {
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
  };
}

test("notification draft validates bounded levels and app destinations", () => {
  assert.deepEqual(validateNotificationDraft(draft()), draft());
  assert.throws(() => validateNotificationDraft(draft({ level: "critical" })), /level/i);
  assert.throws(
    () => validateNotificationDraft(draft({ destination: { appId: "System", target: "updates" } })),
    /appId/i,
  );
  assert.throws(() => validateNotificationDraft(draft({ title: "bad\nline" })), /printable/i);
});

test("notification runtime keeps monotonic bounded unread history", () => {
  const ticks = [100, 90, 90, 110];
  const runtime = createNotificationsRuntime({
    now: () => ticks.shift() ?? 110,
  });
  assert.equal(runtime.schema, NOTIFICATIONS_SCHEMA);

  const first = runtime.publish(draft({ title: "Primeiro" }));
  const second = runtime.publish(draft({ title: "Segundo" }));
  const third = runtime.publish(draft({ title: "Terceiro" }));
  assert.deepEqual([first.createdAt, second.createdAt, third.createdAt], [100, 101, 102]);
  assert.equal(runtime.getSnapshot().unreadCount, 3);
  assert.deepEqual(runtime.getSnapshot().entries.map((entry) => entry.title), [
    "Terceiro",
    "Segundo",
    "Primeiro",
  ]);

  for (let index = 0; index < MAX_NOTIFICATIONS + 5; index += 1) {
    runtime.publish(draft({ title: `Item ${index}` }));
  }
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.entries.length, MAX_NOTIFICATIONS);
  assert.equal(snapshot.unreadCount, MAX_NOTIFICATIONS);
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.policyPersistence, "session");
  assert.equal(snapshot.doNotDisturb, false);
});

test("notification runtime persists read state and non-destructive dismissal", () => {
  const store = memoryStore();
  let tick = 1000;
  const runtime = createNotificationsRuntime({ store, now: () => tick += 1 });
  const first = runtime.publish(draft({ title: "A" }));
  const second = runtime.publish(draft({ title: "B", destination: null }));
  assert.equal(runtime.getSnapshot().persistence, "device");

  runtime.markRead(first.id);
  assert.equal(runtime.getSnapshot().unreadCount, 1);
  runtime.markAllRead();
  assert.equal(runtime.getSnapshot().unreadCount, 0);
  runtime.dismiss(second.id);
  assert.deepEqual(runtime.getSnapshot().entries.map((entry) => entry.id), [first.id]);
  runtime.clearRead();
  assert.equal(runtime.getSnapshot().entries.length, 0);
  assert.equal(store.snapshot().length, 0);
});

test("Do Not Disturb persists independently without consuming unread history", () => {
  const store = memoryStore();
  const runtime = createNotificationsRuntime({ store, now: () => 1500 });
  const entry = runtime.publish(draft({ title: "Durante DND" }));

  runtime.setDoNotDisturb(true);
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.doNotDisturb, true);
  assert.equal(snapshot.policyPersistence, "device");
  assert.equal(snapshot.unreadCount, 1);
  assert.equal(snapshot.entries[0].id, entry.id);
  assert.deepEqual(store.policySnapshot(), { doNotDisturb: true });

  runtime.setDoNotDisturb(false);
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.doNotDisturb, false);
  assert.equal(snapshot.unreadCount, 1, "presentation policy must not mark history read");
  assert.throws(() => runtime.setDoNotDisturb("true"), /boolean/i);
});

test("notification runtime degrades history and policy persistence independently", () => {
  const runtime = createNotificationsRuntime({
    store: memoryStore({ failSave: true, failPolicySave: true }),
    now: () => 2000,
  });
  runtime.publish(draft());
  runtime.setDoNotDisturb(true);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.policyPersistence, "session");
  assert.equal(snapshot.doNotDisturb, true);
  assert.equal(snapshot.entries.length, 1);
});

test("Native notification store round-trips history and Do Not Disturb and fails closed on corruption", () => {
  const data = new Map();
  const localStorage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
  const store = createNativeNotificationStore({ localStorage });
  const runtime = createNotificationsRuntime({ store, now: () => 3000 });
  runtime.publish(draft({ title: "Persistido" }));
  runtime.setDoNotDisturb(true);

  const reloaded = createNotificationsRuntime({
    store: createNativeNotificationStore({ localStorage }),
    now: () => 4000,
  });
  assert.equal(reloaded.getSnapshot().persistence, "device");
  assert.equal(reloaded.getSnapshot().policyPersistence, "device");
  assert.equal(reloaded.getSnapshot().entries[0].title, "Persistido");
  assert.equal(reloaded.getSnapshot().doNotDisturb, true);

  data.set("ordax.native.notifications.v1", "{broken-json");
  data.set("ordax.native.notification-policy.v1", "{broken-json");
  const corrupted = createNotificationsRuntime({
    store: createNativeNotificationStore({ localStorage }),
    now: () => 5000,
  });
  assert.equal(corrupted.getSnapshot().entries.length, 0);
  assert.equal(corrupted.getSnapshot().doNotDisturb, false);
});

test("update notification bridge ignores startup state and publishes only new actionable transitions", () => {
  let tick = 6000;
  const notifications = createNotificationsRuntime({ now: () => tick += 1 });
  const updates = updatePort(updateSnapshot({ status: "pull-error" }));
  const bridge = createUpdateNotificationBridge(updates, notifications);

  assert.equal(notifications.getSnapshot().entries.length, 0, "startup snapshot must not replay");

  updates.push(updateSnapshot({
    status: "applied",
    attemptId: "attempt-2",
    lastAppliedSha: "bbbbbbbb",
  }));
  assert.equal(notifications.getSnapshot().entries.length, 1);
  assert.equal(notifications.getSnapshot().entries[0].level, "success");
  assert.deepEqual(notifications.getSnapshot().entries[0].destination, {
    appId: "system",
    target: "updates",
  });

  notifications.setDoNotDisturb(true);
  updates.push(updateSnapshot({
    status: "running",
    attemptId: "attempt-3",
    bootRefreshRequired: true,
  }));
  assert.equal(notifications.getSnapshot().entries.length, 2);
  assert.equal(notifications.getSnapshot().unreadCount, 2);
  assert.equal(notifications.getSnapshot().doNotDisturb, true);
  assert.equal(notifications.getSnapshot().entries[0].title, "Atualização de base pendente");

  updates.push(updateSnapshot({
    status: "running",
    attemptId: "attempt-3",
    bootRefreshRequired: true,
  }));
  assert.equal(notifications.getSnapshot().entries.length, 2, "identical snapshot must not duplicate");

  updates.push(updateSnapshot({
    status: "pull-error",
    attemptId: "attempt-4",
    bootRefreshRequired: true,
  }));
  assert.equal(notifications.getSnapshot().entries.length, 3);
  assert.equal(notifications.getSnapshot().entries[0].level, "error");

  bridge.destroy();
  updates.push(updateSnapshot({ status: "rolled-back", attemptId: "attempt-5" }));
  assert.equal(notifications.getSnapshot().entries.length, 3, "destroyed bridge must unsubscribe");
});
