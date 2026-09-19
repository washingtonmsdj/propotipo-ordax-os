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
    throw new TypeError("Notes editor save controller requires persist(noteId)");
  }
  const delay = validDelay(delayMs);
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("Notes editor save controller requires timer functions");
  }

  let pendingNoteId = null;
  let timer = null;
  let destroyed = false;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  };

  const consumePending = () => {
    if (pendingNoteId === null) return null;
    const noteId = pendingNoteId;
    pendingNoteId = null;
    return noteId;
  };

  const flush = () => {
    if (destroyed || pendingNoteId === null) return false;
    clearTimer();
    const noteId = consumePending();
    return persist(noteId) !== false;
  };

  const controller = {
    schedule(noteId) {
      if (destroyed) return false;
      const valid = validNoteId(noteId);
      pendingNoteId = valid;
      clearTimer();
      timer = setTimeoutFn(() => {
        timer = null;
        if (destroyed) return;
        const current = consumePending();
        if (current !== null) persist(current);
      }, delay);
      return true;
    },
    flush,
    isPending(noteId = null) {
      if (noteId === null) return pendingNoteId !== null;
      return pendingNoteId === validNoteId(noteId);
    },
    getPendingNoteId() {
      return pendingNoteId;
    },
    destroy({ flushPending = true } = {}) {
      if (destroyed) return false;
      if (flushPending) flush();
      clearTimer();
      pendingNoteId = null;
      destroyed = true;
      return true;
    },
  };

  return Object.freeze(controller);
}
