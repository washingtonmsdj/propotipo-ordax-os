import assert from "node:assert/strict";
import test from "node:test";

import { defineFirstPartyApp } from "../system/apps/app-contract.mjs";
import { notesApp } from "../system/apps/notes/app.mjs";
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

test("app contract models optional host capabilities without changing availability requirements", () => {
  const spec = baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  });
  spec.requiredCapabilities = ["surface.render"];
  spec.optionalCapabilities = ["filesystem.user-space"];
  const app = defineFirstPartyApp(spec);

  assert.deepEqual(app.requiredCapabilities, ["surface.render"]);
  assert.deepEqual(app.optionalCapabilities, ["filesystem.user-space"]);
  assert.equal(Object.isFrozen(app.optionalCapabilities), true);
});

test("app contract defaults optional capabilities to an empty frozen list", () => {
  const app = defineFirstPartyApp(baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  }));
  assert.deepEqual(app.optionalCapabilities, []);
  assert.equal(Object.isFrozen(app.optionalCapabilities), true);
});

test("app contract rejects duplicated and overlapping optional capabilities", () => {
  const panel = {
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  };

  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      optionalCapabilities: ["filesystem.user-space", "filesystem.user-space"],
    }),
    /invalid optional capabilities/,
  );

  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      requiredCapabilities: ["filesystem.user-space"],
      optionalCapabilities: ["filesystem.user-space"],
    }),
    /cannot require and optionally consume the same capability/,
  );
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

test("Notes stays a first-party app and advertises native file-space as optional", () => {
  assert.equal(notesApp.id, "notes");
  assert.deepEqual(notesApp.requiredCapabilities, []);
  assert.deepEqual(notesApp.optionalCapabilities, ["filesystem.user-space"]);
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

test("file-space contract accepts the logical root path", () => {
  const listing = validateFileListing({ path: "/", entries: [] });
  assert.equal(listing.path, "/");
  assert.deepEqual(listing.entries, []);
});
