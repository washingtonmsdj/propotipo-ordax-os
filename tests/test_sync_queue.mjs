import assert from "node:assert/strict";
import test from "node:test";
import { createAppearanceSyncMutation, createSyncMutationQueue } from "../system/services/sync/runtime.mjs";

test("queue deduplicates retry", () => {
  const queue = createSyncMutationQueue();
  const mutation = createAppearanceSyncMutation({ theme: "light", baseServerRevision: 1, idempotencyKey: "appearance-device-0001" });
  queue.enqueue(mutation);
  queue.enqueue(mutation);
  assert.equal(queue.snapshot().length, 1);
});
