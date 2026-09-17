import assert from "node:assert/strict";
import test from "node:test";

import { defineFirstPartyApp } from "../system/apps/app-contract.mjs";

function baseSpec(panel) {
  return {
    id: "example",
    title: "Example",
    description: "Example app",
    monogram: "EX",
    singleton: true,
    requiredCapabilities: [],
    panels: [panel],
  };
}

test("app contract accepts a bounded extension slot", () => {
  const app = defineFirstPartyApp(baseSpec({
    kind: "extension",
    extensionId: "file-space",
    label: "Files",
    title: "Files",
    body: "Fallback",
  }));
  assert.equal(app.panels[0].extensionId, "file-space");
  assert.equal(Object.isFrozen(app.panels[0]), true);
});

test("app contract rejects invalid extension identifiers", () => {
  assert.throws(
    () => defineFirstPartyApp(baseSpec({
      kind: "extension",
      extensionId: "../native",
      label: "Invalid",
      title: "Invalid",
    })),
    /valid extensionId/,
  );
});

test("app contract rejects obsolete identity-specific panel kinds", () => {
  for (const kind of ["identity-session", "identity-actions"]) {
    assert.throws(
      () => defineFirstPartyApp(baseSpec({
        kind,
        label: "Legacy identity panel",
        title: "Legacy",
      })),
      /unsupported panel kind/,
    );
  }
});
