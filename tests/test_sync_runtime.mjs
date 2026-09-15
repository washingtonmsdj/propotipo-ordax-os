import assert from "node:assert/strict";
import test from "node:test";
import { createAppearanceSyncObject } from "../system/services/sync/runtime.mjs";

test("appearance sync object validates", () => {
  const object = createAppearanceSyncObject({ theme: "light", serverRevision: 7 });
  assert.equal(object.payload.theme, "light");
  assert.equal(object.serverRevision, 7);
});
