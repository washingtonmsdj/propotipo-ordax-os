import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import {
  MAX_NOTE_TEXT_CHARS,
  NOTES_STORE_SCHEMA,
} from "../system/contracts/notes-store.mjs";
import { createNotesRuntime } from "../system/services/notes/runtime.mjs";
import { createNotesFileImporter } from "../system/services/files/notes-import.mjs";

function fileSpace(readTextFile, calls = []) {
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    async list() { calls.push("list"); throw new Error("unused"); },
    async createDirectory() { calls.push("createDirectory"); throw new Error("unused"); },
    async readTextFile(path) { calls.push(`read:${path}`); return readTextFile(path); },
    async renameEntry() { calls.push("renameEntry"); throw new Error("unused"); },
    async copyFile() { calls.push("copyFile"); throw new Error("unused"); },
    async moveEntry() { calls.push("moveEntry"); throw new Error("unused"); },
    async exportFile() { calls.push("exportFile"); throw new Error("unused"); },
    async importFile() { calls.push("importFile"); throw new Error("unused"); },
  });
}

function noteById(runtime, noteId) {
  return runtime.getSnapshot().document.notes.find((note) => note.id === noteId);
}

test("text import creates a note with exact content and a file-origin reference without mutating Files", async () => {
  const calls = [];
  const sourcePath = "/Documentos/roteiro.txt";
  const sourceText = "Cena 1\nCena 2\n";
  const notes = createNotesRuntime({ now: () => 1000 });
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async (path) => ({
      path,
      size: new TextEncoder().encode(sourceText).byteLength,
      text: sourceText,
    }), calls),
    notesRuntime: notes,
  });

  const result = await importer.importTextFile(sourcePath);
  assert.equal(result.status, "created");
  assert.equal(result.sourcePath, sourcePath);
  assert.equal(result.persistence, "session");
  assert.equal(result.persistenceOk, true);
  assert.deepEqual(calls, [`read:${sourcePath}`]);

  const note = noteById(notes, result.noteId);
  assert.equal(note.title, "roteiro.txt");
  assert.equal(note.body, sourceText);
  assert.equal(note.richBody.blocks.map((block) => block.text).join("\n"), sourceText);
  assert.equal(note.projectId, result.projectId);
  assert.deepEqual(
    note.references.map((reference) => ({
      kind: reference.kind,
      title: reference.title,
      detail: reference.detail,
      path: reference.path,
    })),
    [{ kind: "file", title: "roteiro.txt", detail: sourcePath, path: sourcePath }],
  );
});

test("oversized text is rejected before Notes is mutated and is never silently truncated", async () => {
  const text = "x".repeat(MAX_NOTE_TEXT_CHARS + 1);
  const notes = createNotesRuntime({ now: () => 2000 });
  const before = notes.getSnapshot().document;
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async (path) => ({ path, size: text.length, text })),
    notesRuntime: notes,
  });

  assert.deepEqual(await importer.importTextFile("/Documentos/grande.txt"), {
    status: "failed",
    code: "source-too-large",
  });
  assert.deepEqual(notes.getSnapshot().document, before);
});

test("host read failures become stable codes without leaking exception text", async () => {
  const notes = createNotesRuntime({ now: () => 3000 });
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async () => {
      throw new Error("token=do-not-leak user@example.com /home/alice/private");
    }),
    notesRuntime: notes,
  });

  const result = await importer.importTextFile("/Documentos/falha.txt");
  assert.deepEqual(result, { status: "failed", code: "source-read-failed" });
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak|user@example\.com|\/home\/alice/);
});

test("adapter path mismatch fails closed before creating a note", async () => {
  const notes = createNotesRuntime({ now: () => 4000 });
  const before = notes.getSnapshot().document;
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async () => ({
      path: "/Documentos/outro.txt",
      size: 3,
      text: "abc",
    })),
    notesRuntime: notes,
  });

  assert.deepEqual(await importer.importTextFile("/Documentos/alvo.txt"), {
    status: "failed",
    code: "source-mismatch",
  });
  assert.deepEqual(notes.getSnapshot().document, before);
});

test("a successfully created note reports degraded persistence instead of claiming durable save", async () => {
  let stored = null;
  let saves = 0;
  const store = Object.freeze({
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() { return stored; },
    save(snapshot) {
      stored = snapshot;
      saves += 1;
      return saves === 1;
    },
  });
  const notes = createNotesRuntime({ store, now: () => 5000 });
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async (path) => ({ path, size: 4, text: "nota" })),
    notesRuntime: notes,
  });

  const result = await importer.importTextFile("/Documentos/nota.txt");
  assert.equal(result.status, "created");
  assert.equal(result.persistence, "device");
  assert.equal(result.persistenceOk, false);
  assert.equal(noteById(notes, result.noteId).body, "nota");
});

test("source reference bounds are checked before host I/O", async () => {
  const calls = [];
  const notes = createNotesRuntime({ now: () => 6000 });
  const importer = createNotesFileImporter({
    fileSpace: fileSpace(async (path) => ({ path, size: 1, text: "x" }), calls),
    notesRuntime: notes,
  });
  const longName = "a".repeat(513);
  const result = await importer.importTextFile(`/Documentos/${longName}`);
  assert.deepEqual(result, { status: "failed", code: "source-reference-too-long" });
  assert.deepEqual(calls, []);
});
