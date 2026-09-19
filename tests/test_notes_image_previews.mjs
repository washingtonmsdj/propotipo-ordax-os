import assert from "node:assert/strict";
import test from "node:test";

import {
  createNotesImagePreviewCache,
  isNotesImageFileName,
  isNotesImageReference,
  notesImageReferenceKey,
} from "../system/apps/notes/ui/image-previews.mjs";

function imageReference(overrides = {}) {
  return {
    id: "ref-image",
    kind: "file",
    title: "capa.png",
    detail: "Imagem local",
    path: "/Imagens/capa.png",
    ...overrides,
  };
}

function fakeWindow() {
  const created = [];
  const revoked = [];
  let ordinal = 0;
  return {
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = `blob:notes-preview-${++ordinal}`;
        created.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    created,
    revoked,
  };
}

test("image reference classification stays narrow and excludes SVG", () => {
  assert.equal(isNotesImageFileName("foto.PNG"), true);
  assert.equal(isNotesImageFileName("foto.webp"), true);
  assert.equal(isNotesImageFileName("vetor.svg"), false);
  assert.equal(isNotesImageReference(imageReference()), true);
  assert.equal(isNotesImageReference(imageReference({ detail: "Arquivo local" })), false);
  assert.equal(isNotesImageReference(imageReference({ path: "/Imagens/capa.svg", title: "capa.svg" })), false);
  assert.equal(notesImageReferenceKey("note-1", imageReference()), "note-1:ref-image");
});

test("preview cache owns object URL creation and revocation", async () => {
  const windowRef = fakeWindow();
  const calls = [];
  const fileSpace = {
    async readImagePreview(path) {
      calls.push(path);
      return {
        path,
        size: 4,
        mime: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      };
    },
  };
  const cache = createNotesImagePreviewCache({ fileSpace, windowRef });
  const reference = imageReference();

  assert.equal(cache.available, true);
  assert.equal(cache.get("note-1", reference), null);

  const ready = await cache.ensure("note-1", reference, () => true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.url, "blob:notes-preview-1");
  assert.deepEqual(calls, ["/Imagens/capa.png"]);
  assert.equal(cache.get("note-1", reference), ready);
  assert.equal(windowRef.created.length, 1);
  assert.equal(windowRef.revoked.length, 0);

  cache.releaseExcept(new Set());
  assert.equal(cache.get("note-1", reference), null);
  assert.deepEqual(windowRef.revoked, ["blob:notes-preview-1"]);
});

test("preview cache never retains a stale image relation", async () => {
  const windowRef = fakeWindow();
  const fileSpace = {
    async readImagePreview(path) {
      return {
        path,
        size: 3,
        mime: "image/jpeg",
        bytes: new Uint8Array([255, 216, 255]),
      };
    },
  };
  const cache = createNotesImagePreviewCache({ fileSpace, windowRef });
  const reference = imageReference({
    title: "foto.jpg",
    path: "/Imagens/foto.jpg",
  });

  const result = await cache.ensure("note-1", reference, () => false);
  assert.equal(result, null);
  assert.equal(cache.get("note-1", reference), null);
  assert.deepEqual(windowRef.revoked, ["blob:notes-preview-1"]);
});

test("preview cache rejects adapter path mismatches without exposing the wrong file", async () => {
  const windowRef = fakeWindow();
  const cache = createNotesImagePreviewCache({
    fileSpace: {
      async readImagePreview() {
        return {
          path: "/Imagens/outra.png",
          size: 4,
          mime: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        };
      },
    },
    windowRef,
  });
  const reference = imageReference();

  const failed = await cache.ensure("note-1", reference, () => true);
  assert.equal(failed.status, "failed");
  assert.equal(cache.get("note-1", reference).status, "failed");
  assert.equal(windowRef.created.length, 0);
});

test("preview failures are stable cache states and do not retry-render loops", async () => {
  const windowRef = fakeWindow();
  let calls = 0;
  const cache = createNotesImagePreviewCache({
    fileSpace: {
      async readImagePreview() {
        calls += 1;
        throw new Error("preview unavailable");
      },
    },
    windowRef,
  });
  const reference = imageReference();

  const failed = await cache.ensure("note-1", reference, () => true);
  assert.equal(failed.status, "failed");
  assert.equal(cache.get("note-1", reference).status, "failed");

  const second = await cache.ensure("note-1", reference, () => true);
  assert.equal(second.status, "failed");
  assert.equal(calls, 1);
  assert.equal(windowRef.created.length, 0);
});

test("destroy revokes every live URL and makes future loads inert", async () => {
  const windowRef = fakeWindow();
  const fileSpace = {
    async readImagePreview(path) {
      return {
        path,
        size: 4,
        mime: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      };
    },
  };
  const cache = createNotesImagePreviewCache({ fileSpace, windowRef });
  const first = imageReference();
  const second = imageReference({
    id: "ref-image-2",
    title: "segunda.png",
    path: "/Imagens/segunda.png",
  });

  await cache.ensure("note-1", first, () => true);
  await cache.ensure("note-1", second, () => true);
  cache.destroy();

  assert.deepEqual(windowRef.revoked.sort(), [
    "blob:notes-preview-1",
    "blob:notes-preview-2",
  ]);
  assert.equal(await cache.ensure("note-1", first, () => true), null);
});
