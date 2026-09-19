import assert from "node:assert/strict";
import test from "node:test";

import {
  createNotesLinkReference,
  notesWebReferenceHost,
  parseNotesWebHref,
} from "../system/surface/ui/notes-reference-links.mjs";

test("web reference parser accepts only canonical http and https URLs", () => {
  assert.deepEqual(
    parseNotesWebHref("  https://Example.COM/docs?q=1  "),
    {
      href: "https://example.com/docs?q=1",
      host: "example.com",
    },
  );
  assert.deepEqual(
    parseNotesWebHref("http://example.com"),
    {
      href: "http://example.com/",
      host: "example.com",
    },
  );

  for (const value of [
    "",
    "not a url",
    "javascript:alert(1)",
    "ftp://example.com/file",
    "mailto:user@example.com",
  ]) {
    assert.equal(parseNotesWebHref(value), null);
  }
});

test("reference host is derived safely and malformed stored values remain displayable", () => {
  assert.equal(notesWebReferenceHost("https://docs.example.com/path"), "docs.example.com");
  assert.equal(notesWebReferenceHost("valor-legado"), "valor-legado");
  assert.equal(notesWebReferenceHost(null), "");
});

test("link reference factory normalizes href and uses the host as the fallback title", () => {
  assert.deepEqual(
    createNotesLinkReference("https://EXAMPLE.com/path", ""),
    {
      kind: "link",
      title: "example.com",
      detail: "Link",
      href: "https://example.com/path",
    },
  );
  assert.deepEqual(
    createNotesLinkReference("https://example.com/path", "  Documentação  "),
    {
      kind: "link",
      title: "Documentação",
      detail: "Link",
      href: "https://example.com/path",
    },
  );
  assert.throws(
    () => createNotesLinkReference("javascript:alert(1)", "X"),
    /must use http or https/,
  );
});
