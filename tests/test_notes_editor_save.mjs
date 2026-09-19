import assert from "node:assert/strict";
import test from "node:test";

import { createNotesEditorSaveController } from "../system/surface/ui/notes-editor-save.mjs";

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

test("autosave debounces repeated edits for the same note", () => {
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

  assert.equal(controller.schedule("note-a"), true);
  assert.equal(controller.schedule("note-a"), true);
  assert.equal(timers.count(), 1);
  assert.deepEqual(timers.delays(), [320]);
  assert.equal(controller.isPending("note-a"), true);

  timers.runAll();
  assert.deepEqual(persisted, ["note-a"]);
  assert.equal(controller.isPending(), false);
});

test("a newer note supersedes the pending debounce and flush targets the newest note", () => {
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
  assert.equal(controller.getPendingNoteId(), "note-b");
  assert.equal(controller.isPending("note-a"), false);
  assert.equal(controller.isPending("note-b"), true);

  assert.equal(controller.flush(), true);
  assert.deepEqual(persisted, ["note-b"]);
  assert.equal(timers.count(), 0);
  assert.equal(controller.flush(), false);
});

test("flush reports persistence failure without leaving a phantom pending edit", () => {
  const timers = fakeTimers();
  const controller = createNotesEditorSaveController({
    persist() {
      return false;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  controller.schedule("note-a");
  assert.equal(controller.flush(), false);
  assert.equal(controller.isPending(), false);
  assert.equal(timers.count(), 0);
});

test("destroy flushes once by default and disables later scheduling", () => {
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
  assert.equal(controller.destroy(), true);
  assert.deepEqual(persisted, ["note-a"]);
  assert.equal(timers.count(), 0);
  assert.equal(controller.destroy(), false);
  assert.equal(controller.schedule("note-b"), false);
  timers.runAll();
  assert.deepEqual(persisted, ["note-a"]);
});

test("destroy can explicitly discard a pending timer without persisting", () => {
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
  assert.equal(controller.destroy({ flushPending: false }), true);
  assert.deepEqual(persisted, []);
  assert.equal(timers.count(), 0);
  assert.equal(controller.getPendingNoteId(), null);
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
});
