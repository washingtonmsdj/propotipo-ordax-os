import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import {
  createNotesFilePicker,
  joinNotesLogicalPath,
  notesParentLogicalPath,
} from "../system/apps/notes/ui/file-picker.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fileSpace(list) {
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    list,
    async createDirectory() { throw new Error("unused"); },
    async readTextFile() { throw new Error("unused"); },
    async renameEntry() { throw new Error("unused"); },
    async copyFile() { throw new Error("unused"); },
    async moveEntry() { throw new Error("unused"); },
    async exportFile() { throw new Error("unused"); },
    async importFile() { throw new Error("unused"); },
  });
}

test("logical file-picker paths stay absolute and traversal-free", () => {
  assert.equal(joinNotesLogicalPath("/", "foto.png"), "/foto.png");
  assert.equal(joinNotesLogicalPath("/Imagens", "foto.png"), "/Imagens/foto.png");
  assert.equal(notesParentLogicalPath("/Imagens/Viagem/foto.png"), "/Imagens/Viagem");
  assert.equal(notesParentLogicalPath("/Imagens"), "/");
  assert.equal(notesParentLogicalPath("/"), "/");
  assert.throws(() => joinNotesLogicalPath("/Imagens", "../fora.png"), /entry name is invalid/);
  assert.throws(() => joinNotesLogicalPath("/Imagens", "pasta/foto.png"), /entry name is invalid/);
});

test("picker exposes bounded listing state and only selects listed files", async () => {
  const port = fileSpace(async (path) => ({
    path,
    entries: [
      { name: "Pasta", kind: "directory", size: 0, modifiedAt: 1 },
      { name: "foto.png", kind: "file", size: 12, modifiedAt: 2 },
    ],
  }));
  const picker = createNotesFilePicker({ fileSpace: port });
  const opened = picker.open("image", "/Imagens");

  assert.equal(picker.getSnapshot().open, true);
  assert.equal(picker.getSnapshot().pending, true);
  assert.equal(picker.getSnapshot().purpose, "image");
  assert.equal(await opened, true);

  const ready = picker.getSnapshot();
  assert.equal(ready.pending, false);
  assert.equal(ready.path, "/Imagens");
  assert.equal(ready.listing.entries.length, 2);
  assert.equal(picker.select("/Imagens/Pasta"), false);
  assert.equal(picker.select("/Imagens/nao-listado.png"), false);
  assert.equal(picker.select("/Imagens/foto.png"), true);
  assert.equal(picker.getSnapshot().selectedPath, "/Imagens/foto.png");

  const selection = picker.consumeSelection();
  assert.deepEqual(selection, { path: "/Imagens/foto.png", purpose: "image" });
  assert.equal(picker.getSnapshot().open, false);
  assert.equal(picker.getSnapshot().selectedPath, null);
});

test("stale directory responses cannot overwrite a newer navigation result", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const picker = createNotesFilePicker({
    fileSpace: fileSpace((path) => {
      calls.push(path);
      return calls.length === 1 ? first.promise : second.promise;
    }),
  });

  const opening = picker.open("file", "/A");
  const newer = picker.navigate("/B");

  second.resolve({
    path: "/B",
    entries: [{ name: "b.txt", kind: "file", size: 1, modifiedAt: 1 }],
  });
  assert.equal(await newer, true);
  assert.equal(picker.getSnapshot().path, "/B");

  first.resolve({
    path: "/A",
    entries: [{ name: "a.txt", kind: "file", size: 1, modifiedAt: 1 }],
  });
  assert.equal(await opening, false);
  assert.equal(picker.getSnapshot().path, "/B");
  assert.equal(picker.getSnapshot().listing.entries[0].name, "b.txt");
});

test("closing the picker invalidates pending I/O without reopening it", async () => {
  const request = deferred();
  const picker = createNotesFilePicker({
    fileSpace: fileSpace(() => request.promise),
  });

  const opening = picker.open("file", "/Documentos");
  picker.close();
  request.resolve({ path: "/Documentos", entries: [] });

  assert.equal(await opening, false);
  assert.equal(picker.getSnapshot().open, false);
  assert.equal(picker.getSnapshot().listing, null);
  assert.equal(picker.getSnapshot().error, "");
});

test("listing path mismatches fail closed with a stable user-facing error", async () => {
  const picker = createNotesFilePicker({
    fileSpace: fileSpace(async () => ({ path: "/Outra", entries: [] })),
  });

  assert.equal(await picker.open("file", "/Esperada"), false);
  assert.equal(picker.getSnapshot().open, true);
  assert.equal(picker.getSnapshot().pending, false);
  assert.equal(picker.getSnapshot().listing, null);
  assert.equal(picker.getSnapshot().error, "Não foi possível abrir esta pasta.");
});

test("unavailable and destroyed pickers do not invent filesystem capability", async () => {
  const unavailable = createNotesFilePicker();
  assert.equal(unavailable.getSnapshot().available, false);
  assert.equal(await unavailable.open("file"), false);

  let calls = 0;
  const picker = createNotesFilePicker({
    fileSpace: fileSpace(async (path) => ({ path, entries: [] })),
  });
  const unsubscribe = picker.subscribe(() => { calls += 1; });
  assert.equal(calls, 1);
  picker.destroy();
  unsubscribe();
  assert.equal(await picker.open("file"), false);
  assert.equal(picker.getSnapshot().open, false);
});
