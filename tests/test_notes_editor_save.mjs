import assert from "node:assert/strict";
import test from "node:test";

import { createNotesEditorSaveController } from "../system/apps/notes/ui/editor-save.mjs";

function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      tasks.delete(id);
    },
    count() {
      return tasks.size;
    },
    runAll() {
      const current = [...tasks.entries()];
      tasks.clear();
      for (const [, task] of current) task.callback();
    },
    delays() {
      return [...tasks.values()].map((task) => task.delay);
    },
  };
}

test("autosave debounces repeated edits for the same note and keeps the latest payload", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId, payload) {
      persisted.push({ noteId, payload });
      return true;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  assert.equal(controller.schedule("note-a", { title: "A1" }), true);
  assert.equal(controller.schedule("note-a", { title: "A2" }), true);
  assert.equal(timers.count(), 1);
  assert.deepEqual(timers.delays(), [320]);
  assert.equal(controller.isPending("note-a"), true);

  timers.runAll();
  assert.deepEqual(persisted, [{ noteId: "note-a", payload: { title: "A2" } }]);
  assert.equal(controller.isPending(), false);
});

test("different notes keep independent pending snapshots", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId, payload) {
      persisted.push({ noteId, payload });
      return true;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a", { title: "A" });
  controller.schedule("note-b", { title: "B" });

  assert.equal(timers.count(), 2);
  assert.deepEqual(controller.getPendingNoteIds(), ["note-a", "note-b"]);
  assert.equal(controller.getPendingNoteId(), "note-b");
  assert.equal(controller.isPending("note-a"), true);
  assert.equal(controller.isPending("note-b"), true);

  timers.runAll();
  assert.deepEqual(persisted, [
    { noteId: "note-a", payload: { title: "A" } },
    { noteId: "note-b", payload: { title: "B" } },
  ]);
  assert.equal(controller.isPending(), false);
});

test("flush can persist one note without consuming another pending edit", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId, payload) {
      persisted.push({ noteId, payload });
      return true;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a", { body: "A" });
  controller.schedule("note-b", { body: "B" });

  assert.equal(controller.flush("note-a"), true);
  assert.deepEqual(persisted, [{ noteId: "note-a", payload: { body: "A" } }]);
  assert.equal(controller.isPending("note-a"), false);
  assert.equal(controller.isPending("note-b"), true);
  assert.equal(timers.count(), 1);

  assert.equal(controller.flush(), true);
  assert.deepEqual(persisted, [
    { noteId: "note-a", payload: { body: "A" } },
    { noteId: "note-b", payload: { body: "B" } },
  ]);
  assert.equal(timers.count(), 0);
});

test("flush reports aggregate persistence failure without phantom pending edits", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId) {
      persisted.push(noteId);
      return noteId !== "note-b";
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a");
  controller.schedule("note-b");

  assert.equal(controller.flush(), false);
  assert.deepEqual(persisted, ["note-a", "note-b"]);
  assert.equal(controller.isPending(), false);
  assert.equal(timers.count(), 0);
});

test("destroy flushes all notes once by default and disables later scheduling", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId, payload) {
      persisted.push({ noteId, payload });
      return true;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a", { title: "A" });
  controller.schedule("note-b", { title: "B" });
  assert.equal(controller.destroy(), true);
  assert.deepEqual(persisted, [
    { noteId: "note-a", payload: { title: "A" } },
    { noteId: "note-b", payload: { title: "B" } },
  ]);
  assert.equal(timers.count(), 0);
  assert.equal(controller.destroy(), false);
  assert.equal(controller.schedule("note-c"), false);
  timers.runAll();
  assert.equal(persisted.length, 2);
});

test("destroy can explicitly discard all pending timers without persisting", () => {
  const timers = fakeTimers();
  const persisted = [];
  const controller = createNotesEditorSaveController({
    persist(noteId) {
      persisted.push(noteId);
      return true;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a");
  controller.schedule("note-b");
  assert.equal(controller.destroy({ flushPending: false }), true);
  assert.deepEqual(persisted, []);
  assert.equal(timers.count(), 0);
  assert.equal(controller.getPendingNoteId(), null);
  assert.deepEqual(controller.getPendingNoteIds(), []);
});

test("controller rejects invalid configuration and note ids", () => {
  assert.throws(() => createNotesEditorSaveController(), /requires persist/);
  assert.throws(
    () => createNotesEditorSaveController({ persist() {}, delayMs: -1 }),
    /save delay/,
  );

  const timers = fakeTimers();
  const controller = createNotesEditorSaveController({
    persist() {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  assert.throws(() => controller.schedule(""), /requires a note id/);
  assert.throws(() => controller.isPending("   "), /requires a note id/);
  assert.throws(() => controller.flush(""), /requires a note id/);
});
