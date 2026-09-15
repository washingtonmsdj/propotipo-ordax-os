import test from "node:test";
import assert from "node:assert/strict";

import { validateAccountRuntime } from "../system/services/account/runtime.mjs";

test("web baseline accepts unavailable identity when account capability is not advertised", () => {
  const runtime = validateAccountRuntime(
    { capabilityIds: ["network.https"], connectivity: "online" },
    { state: "unavailable" },
    { supportedActions: [] },
  );
  assert.equal(runtime.identity.state, "unavailable");
  assert.deepEqual(runtime.actions.supportedActions, []);
});

test("sync capability requires account capability", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["sync.safe-state"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: [] },
    ),
    TypeError,
  );
});

test("available session and account capability must agree", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["account.identity"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: [] },
    ),
    TypeError,
  );
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["network.https"], connectivity: "online" },
      { state: "signed-out" },
      { supportedActions: [] },
    ),
    TypeError,
  );
  assert.doesNotThrow(() => validateAccountRuntime(
    { capabilityIds: ["account.identity"], connectivity: "online" },
    { state: "signed-out" },
    { supportedActions: [] },
  ));
});

test("identity commands cannot exist while identity is unavailable", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["network.https"], connectivity: "online" },
      { state: "unavailable" },
      { supportedActions: ["sign-in"] },
    ),
    TypeError,
  );
});

test("supported command families remain provider-neutral across session states", () => {
  const capabilities = { capabilityIds: ["account.identity"], connectivity: "online" };
  assert.doesNotThrow(() => validateAccountRuntime(
    capabilities,
    { state: "signed-out" },
    { supportedActions: ["sign-in", "sign-out"] },
  ));
  assert.doesNotThrow(() => validateAccountRuntime(
    capabilities,
    { state: "signed-in", subjectId: "user-1", displayName: "User" },
    { supportedActions: ["sign-in", "sign-out"] },
  ));
});
