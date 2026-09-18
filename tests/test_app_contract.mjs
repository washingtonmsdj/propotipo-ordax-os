import assert from "node:assert/strict";
import test from "node:test";

import { defineFirstPartyApp } from "../system/apps/app-contract.mjs";
import { validateFileListing } from "../system/contracts/file-space.mjs";

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

test("file-space contract accepts the logical root path", () => {
  const listing = validateFileListing({ path: "/", entries: [] });
  assert.equal(listing.path, "/");
  assert.deepEqual(listing.entries, []);
});
