import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeClientDiagnostic,
} from "../system/adapters/native/client-diagnostics.mjs";

test("client diagnostic keeps only stage type and local module location", () => {
  const error = new ReferenceError("secret SSID Casa must not cross");
  error.stack = [
    "ReferenceError: secret SSID Casa must not cross",
    "    at render (http://127.0.0.1/system/surface/ui/settings-overview-controls.mjs:321:17)",
    "    at other (https://example.invalid/private-user-value:1:1)",
  ].join("\n");
  assert.deepEqual(
    sanitizeClientDiagnostic("settings-network-management", error),
    {
      stage: "settings-network-management",
      errorName: "ReferenceError",
      source: "settings-overview-controls.mjs:321:17",
    },
  );
  const serialized = JSON.stringify(sanitizeClientDiagnostic("settings-network-management", error));
  assert.doesNotMatch(serialized, /secret|SSID Casa|example\.invalid/);
});

test("client diagnostic fails closed to generic bounded fields", () => {
  const diagnostic = sanitizeClientDiagnostic("../unsafe", {
    name: "Bad Name!",
    stack: "at x (/home/user/private.txt:10:20)",
  });
  assert.deepEqual(diagnostic, {
    stage: "surface",
    errorName: "Error",
    source: "",
  });
});
