import {
  assertFileSpacePort,
  validateFileSpacePath,
} from "../../../contracts/file-space.mjs";

const PURPOSES = new Set(["file", "image"]);

function freezeSnapshot(value) {
  return Object.freeze({
    available: value.available,
    open: value.open,
    path: value.path,
    listing: value.listing,
    pending: value.pending,
    error: value.error,
    purpose: value.purpose,
    selectedPath: value.selectedPath,
  });
}

function initialState(available) {
  return freezeSnapshot({
    available,
    open: false,
    path: "/",
    listing: null,
    pending: false,
    error: "",
    purpose: "file",
    selectedPath: null,
  });
}

export function joinNotesLogicalPath(path, name) {
  const base = validateFileSpacePath(path);
  if (
    typeof name !== "string"
    || !name
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\0")
  ) {
    throw new TypeError("Notes file-picker entry name is invalid");
  }
  return validateFileSpacePath(base === "/" ? `/${name}` : `${base}/${name}`);
}

export function notesParentLogicalPath(path) {
  const valid = validateFileSpacePath(path);
  if (valid === "/") return "/";
  const parts = valid.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function createNotesFilePicker({ fileSpace = null } = {}) {
  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  let state = initialState(port !== null);
  let generation = 0;
  let destroyed = false;
  let notificationQueued = false;
  const listeners = new Set();

  const notify = () => {
    if (destroyed || notificationQueued) return;
    notificationQueued = true;
    queueMicrotask(() => {
      notificationQueued = false;
      if (destroyed) return;
      const snapshot = state;
      for (const listener of listeners) listener(snapshot);
    });
  };

  const commit = (patch) => {
    state = freezeSnapshot({ ...state, ...patch });
    notify();
    return state;
  };

  const close = () => {
    generation += 1;
    if (
      !state.open
      && state.listing === null
      && state.pending === false
      && state.error === ""
      && state.purpose === "file"
      && state.selectedPath === null
    ) {
      return state;
    }
    state = initialState(port !== null);
    notify();
    return state;
  };

  const load = async (path) => {
    if (destroyed || !port || !state.open) return false;
    const target = validateFileSpacePath(path);
    const requestGeneration = ++generation;
    commit({
      path: target,
      listing: null,
      pending: true,
      error: "",
      selectedPath: null,
    });
    try {
      const listing = await port.list(target);
      if (destroyed || requestGeneration !== generation || !state.open) return false;
      if (listing.path !== target) {
        throw new TypeError("File-space listing path does not match the requested directory");
      }
      commit({
        path: listing.path,
        listing,
        pending: false,
        error: "",
      });
      return true;
    } catch {
      if (destroyed || requestGeneration !== generation || !state.open) return false;
      commit({
        listing: null,
        pending: false,
        error: "Não foi possível abrir esta pasta.",
      });
      return false;
    }
  };

  const picker = {
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Notes file-picker listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async open(purpose = "file", path = "/") {
      if (destroyed || !port) return false;
      if (!PURPOSES.has(purpose)) {
        throw new TypeError(`Unsupported Notes file-picker purpose: ${String(purpose)}`);
      }
      const target = validateFileSpacePath(path);
      state = freezeSnapshot({
        available: true,
        open: true,
        path: target,
        listing: null,
        pending: false,
        error: "",
        purpose,
        selectedPath: null,
      });
      notify();
      return load(target);
    },
    navigate(path) {
      return load(path);
    },
    up() {
      if (!state.open || state.path === "/") return Promise.resolve(false);
      return load(notesParentLogicalPath(state.path));
    },
    select(path) {
      if (destroyed || !state.open || state.pending || !state.listing) return false;
      const target = validateFileSpacePath(path);
      const entry = state.listing.entries.find((candidate) => (
        candidate.kind === "file"
        && joinNotesLogicalPath(state.listing.path, candidate.name) === target
      ));
      if (!entry) return false;
      if (state.selectedPath === target) return true;
      commit({ selectedPath: target });
      return true;
    },
    consumeSelection() {
      if (!state.open || !state.selectedPath) return null;
      const selection = Object.freeze({
        path: state.selectedPath,
        purpose: state.purpose,
      });
      close();
      return selection;
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      listeners.clear();
      state = initialState(port !== null);
    },
  };

  return Object.freeze(picker);
}
