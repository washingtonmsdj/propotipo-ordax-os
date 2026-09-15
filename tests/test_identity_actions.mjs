import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_ACTIONS_SCHEMA,
  assertIdentityActionsPort,
  isIdentityActionSupported,
  validateIdentityActionsSnapshot,
} from "../system/contracts/identity-actions.mjs";
import { createWebIdentityActions } from "../system/adapters/web/identity-actions.mjs";

test("identity action contract normalizes supported command families", () => {
  const snapshot = validateIdentityActionsSnapshot({ supportedActions: ["sign-in", "sign-out"] });
  assert.deepEqual(snapshot.supportedActions, ["sign-in", "sign-out"]);
  assert.equal(isIdentityActionSupported(snapshot, "sign-in"), true);
  assert.equal(isIdentityActionSupported(snapshot, "sign-out"), true);
});

test("identity action contract rejects unknown and duplicate commands", () => {
  assert.throws(
    () => validateIdentityActionsSnapshot({ supportedActions: ["sign-in", "sign-in"] }),
    TypeError,
  );
  assert.throws(
    () => validateIdentityActionsSnapshot({ supportedActions: ["reset-account"] }),
    TypeError,
  );
});

test("identity action port is schema checked", () => {
  const port = {
    schema: IDENTITY_ACTIONS_SCHEMA,
    getSnapshot: () => ({ supportedActions: [] }),
    subscribe: () => () => {},
    execute: async () => {},
  };
  assert.equal(assertIdentityActionsPort(port), port);
});

test("Web identity actions remain unavailable until a real provider adapter exists", async () => {
  const port = createWebIdentityActions();
  assert.deepEqual(port.getSnapshot().supportedActions, []);
  await assert.rejects(() => port.execute("sign-in"));
  port.dispose();
});
