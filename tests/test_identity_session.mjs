import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_SESSION_SCHEMA,
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../system/contracts/identity-session.mjs";
import { createWebIdentitySession } from "../system/adapters/web/identity.mjs";

test("identity session validates unavailable, signed-out and signed-in states", () => {
  assert.deepEqual(validateIdentitySessionSnapshot({ state: "unavailable" }), {
    state: "unavailable",
    subjectId: null,
    displayName: null,
  });
  assert.deepEqual(validateIdentitySessionSnapshot({ state: "signed-out" }), {
    state: "signed-out",
    subjectId: null,
    displayName: null,
  });
  assert.deepEqual(
    validateIdentitySessionSnapshot({
      state: "signed-in",
      subjectId: "user-1",
      displayName: "Pessoa",
    }),
    { state: "signed-in", subjectId: "user-1", displayName: "Pessoa" },
  );
});

test("signed-in state fails closed without public identity fields", () => {
  assert.throws(
    () => validateIdentitySessionSnapshot({ state: "signed-in", displayName: "Pessoa" }),
    TypeError,
  );
  assert.throws(
    () => validateIdentitySessionSnapshot({ state: "signed-in", subjectId: "user-1" }),
    TypeError,
  );
});

test("web adapter remains explicitly unavailable until real auth integration exists", () => {
  const port = createWebIdentitySession();
  assert.equal(port.schema, IDENTITY_SESSION_SCHEMA);
  assertIdentitySessionPort(port);
  assert.deepEqual(port.getSnapshot(), {
    state: "unavailable",
    subjectId: null,
    displayName: null,
  });
  port.dispose();
});
