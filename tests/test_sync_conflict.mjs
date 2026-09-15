import assert from "node:assert/strict";
import test from "node:test";
import { createAppearanceSyncObject, resolveAppearanceSyncConflict } from "../system/services/sync/runtime.mjs";

test("equal revision divergence is rejected", () => {
  const a = createAppearanceSyncObject({ theme: "dark", serverRevision: 9 });
  const b = createAppearanceSyncObject({ theme: "light", serverRevision: 9 });
  assert.throws(() => resolveAppearanceSyncConflict(a, b));
});
