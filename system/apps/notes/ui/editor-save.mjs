const DEFAULT_DELAY_MS = 320;

function validDelay(value) {
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new TypeError("Notes editor save delay must be a bounded non-negative integer");
  }
  return value;
}

function validNoteId(noteId) {
  if (typeof noteId !== "string" || !noteId.trim()) {
    throw new TypeError("Notes editor save requires a note id");
  }
  return noteId;
}

export function createNotesEditorSaveController({
  persist,
  delayMs = DEFAULT_DELAY_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  if (typeof persist !== "function") {
    throw new TypeError("Notes editor save controller requires persist(noteId, payload)");
  }
  const delay = validDelay(delayMs);
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("Notes editor save controller requires timer functions");
  }

  const pending = new Map();
  let destroyed = false;

  const clearEntryTimer = (entry) => {
    if (entry.timer === null) return;
    clearTimeoutFn(entry.timer);
    entry.timer = null;
  };

  const consume = (noteId) => {
    const entry = pending.get(noteId);
    if (!entry) return null;
    pending.delete(noteId);
    clearEntryTimer(entry);
    return entry;
  };

  const persistEntry = (noteId, entry) => (
    persist(noteId, entry.payload) !== false
  );

  const flushOne = (noteId) => {
    const id = validNoteId(noteId);
    const entry = consume(id);
    if (!entry) return false;
    return persistEntry(id, entry);
  };

  const flushAll = () => {
    if (pending.size === 0) return false;
    const entries = [...pending.entries()];
    pending.clear();
    let ok = true;
    for (const [noteId, entry] of entries) {
      clearEntryTimer(entry);
      if (!persistEntry(noteId, entry)) ok = false;
    }
    return ok;
  };

  const controller = {
    schedule(noteId, payload = null) {
      if (destroyed) return false;
      const id = validNoteId(noteId);
      const previous = pending.get(id);
      if (previous) clearEntryTimer(previous);

      const entry = {
        payload,
        timer: null,
      };
      entry.timer = setTimeoutFn(() => {
        const current = pending.get(id);
        if (current !== entry) return;
        pending.delete(id);
        entry.timer = null;
        if (!destroyed) persistEntry(id, entry);
      }, delay);
      pending.set(id, entry);
      return true;
    },
    flush(noteId = null) {
      if (destroyed) return false;
      return noteId === null ? flushAll() : flushOne(noteId);
    },
    isPending(noteId = null) {
      if (noteId === null) return pending.size > 0;
      return pending.has(validNoteId(noteId));
    },
    getPendingNoteId() {
      if (pending.size === 0) return null;
      return [...pending.keys()].at(-1) ?? null;
    },
    getPendingNoteIds() {
      return Object.freeze([...pending.keys()]);
    },
    destroy({ flushPending = true } = {}) {
      if (destroyed) return false;
      if (flushPending) {
        flushAll();
      } else {
        for (const entry of pending.values()) clearEntryTimer(entry);
        pending.clear();
      }
      destroyed = true;
      return true;
    },
  };

  return Object.freeze(controller);
}
