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

function memoryStore({ failSave = false } = {}) {
  let entries = [];
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
    snapshot() {
      return entries;
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

test("notification runtime degrades persistence to session when durable save fails", () => {
  const runtime = createNotificationsRuntime({
    store: memoryStore({ failSave: true }),
    now: () => 2000,
  });
  runtime.publish(draft());
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.persistence, "session");
  assert.equal(snapshot.entries.length, 1);
});

test("Native notification store round-trips validated records and fails closed on corruption", () => {
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

  const reloaded = createNotificationsRuntime({
    store: createNativeNotificationStore({ localStorage }),
    now: () => 4000,
  });
  assert.equal(reloaded.getSnapshot().persistence, "device");
  assert.equal(reloaded.getSnapshot().entries[0].title, "Persistido");

  data.set("ordax.native.notifications.v1", "{broken-json");
  const corrupted = createNotificationsRuntime({
    store: createNativeNotificationStore({ localStorage }),
    now: () => 5000,
  });
  assert.equal(corrupted.getSnapshot().entries.length, 0);
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

  updates.push(updateSnapshot({
    status: "applied",
    attemptId: "attempt-2",
    lastAppliedSha: "bbbbbbbb",
  }));
  assert.equal(notifications.getSnapshot().entries.length, 1, "identical snapshot must not duplicate");

  updates.push(updateSnapshot({
    status: "running",
    attemptId: "attempt-3",
    bootRefreshRequired: true,
  }));
  assert.equal(notifications.getSnapshot().entries.length, 2);
  assert.equal(notifications.getSnapshot().entries[0].title, "Atualização de base pendente");

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
