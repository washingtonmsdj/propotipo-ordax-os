import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_NAVIGATION_SCHEMA,
  MAX_BROWSER_HISTORY,
  createBrowserNavigation,
  normalizeBrowserAddress,
} from "../system/services/browser/navigation.mjs";

test("browser address normalization accepts only bounded HTTP(S) destinations", () => {
  assert.equal(
    normalizeBrowserAddress("example.com/docs"),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeBrowserAddress("  HTTP://Example.COM:80/a?q=1  "),
    "http://example.com/a?q=1",
  );

  for (const value of [
    "",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "https://user:secret@example.com/",
    "not a host with spaces",
  ]) {
    assert.throws(() => normalizeBrowserAddress(value));
  }
});

test("browser navigation owns bounded explicit history with back, forward and reload", () => {
  const runtime = createBrowserNavigation({ initialUrl: "example.com" });
  assert.equal(runtime.schema, BROWSER_NAVIGATION_SCHEMA);

  let state = runtime.getSnapshot();
  assert.equal(state.currentUrl, "https://example.com/");
  assert.equal(state.canGoBack, false);
  assert.equal(state.canGoForward, false);

  runtime.navigate("https://example.org/a");
  state = runtime.getSnapshot();
  assert.equal(state.currentUrl, "https://example.org/a");
  assert.equal(state.canGoBack, true);

  const beforeReload = state.revision;
  runtime.reload();
  assert.equal(runtime.getSnapshot().revision, beforeReload + 1);

  runtime.back();
  state = runtime.getSnapshot();
  assert.equal(state.currentUrl, "https://example.com/");
  assert.equal(state.canGoForward, true);

  runtime.forward();
  assert.equal(runtime.getSnapshot().currentUrl, "https://example.org/a");
});

test("new navigation after back truncates forward history", () => {
  const runtime = createBrowserNavigation();
  runtime.navigate("a.example");
  runtime.navigate("b.example");
  runtime.navigate("c.example");
  runtime.back();

  runtime.navigate("d.example");
  const state = runtime.getSnapshot();
  assert.deepEqual(state.entries, [
    "https://a.example/",
    "https://b.example/",
    "https://d.example/",
  ]);
  assert.equal(state.canGoForward, false);
});

test("history remains bounded and drops only the oldest explicit destinations", () => {
  const runtime = createBrowserNavigation();
  for (let index = 0; index < MAX_BROWSER_HISTORY + 5; index += 1) {
    runtime.navigate(`host-${index}.example`);
  }
  const state = runtime.getSnapshot();
  assert.equal(state.entries.length, MAX_BROWSER_HISTORY);
  assert.equal(state.entries.at(-1), `https://host-${MAX_BROWSER_HISTORY + 4}.example/`);
  assert.equal(state.entries[0], "https://host-5.example/");
});

test("same-address navigation is a reload and invalid persisted target fails closed", () => {
  const runtime = createBrowserNavigation({ initialUrl: "javascript:alert(1)" });
  assert.equal(runtime.getSnapshot().currentUrl, null);

  runtime.navigate("example.com");
  const before = runtime.getSnapshot();
  runtime.navigate("https://example.com/");
  const after = runtime.getSnapshot();
  assert.deepEqual(after.entries, before.entries);
  assert.equal(after.revision, before.revision + 1);
});

test("reset clears navigation without leaving phantom back-forward state", () => {
  const runtime = createBrowserNavigation();
  runtime.navigate("one.example");
  runtime.navigate("two.example");
  runtime.reset();

  const state = runtime.getSnapshot();
  assert.equal(state.currentUrl, null);
  assert.deepEqual(state.entries, []);
  assert.equal(state.index, -1);
  assert.equal(state.canGoBack, false);
  assert.equal(state.canGoForward, false);
});
