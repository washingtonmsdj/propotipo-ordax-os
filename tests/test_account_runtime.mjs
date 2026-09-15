import test from "node:test";
import assert from "node:assert/strict";

import { validateAccountRuntime } from "../system/services/account/runtime.mjs";

test("web baseline accepts unavailable identity when account capability is not advertised", () => {
  const runtime = validateAccountRuntime(
    { capabilityIds: ["network.https"], connectivity: "online" },
    { state: "unavailable" },
  );
  assert.equal(runtime.identity.state, "unavailable");
});

test("sync capability requires account capability", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["sync.safe-state"], connectivity: "online" },
      { state: "unavailable" },
    ),
    TypeError,
  );
});

test("available session and account capability must agree", () => {
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["account.identity"], connectivity: "online" },
      { state: "unavailable" },
    ),
    TypeError,
  );
  assert.throws(
    () => validateAccountRuntime(
      { capabilityIds: ["network.https"], connectivity: "online" },
      { state: "signed-out" },
    ),
    TypeError,
  );
  assert.doesNotThrow(() => validateAccountRuntime(
    { capabilityIds: ["account.identity"], connectivity: "online" },
    { state: "signed-out" },
  ));
});
