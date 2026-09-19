import { validateImagePreview } from "../../contracts/file-space.mjs";

const IMAGE_FILE_RE = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;

export function isNotesImageFileName(name) {
  return typeof name === "string" && IMAGE_FILE_RE.test(name);
}

export function isNotesImageReference(reference) {
  return reference?.kind === "file"
    && reference.detail === "Imagem local"
    && isNotesImageFileName(reference.path ?? reference.title ?? "");
}

export function notesImageReferenceKey(noteId, reference) {
  return `${noteId}:${reference.id}`;
}

export function createNotesImagePreviewCache({
  fileSpace = null,
  windowRef = globalThis.window,
} = {}) {
  const entries = new Map();
  let ordinal = 0;
  let destroyed = false;

  const createObjectURL = windowRef?.URL?.createObjectURL?.bind(windowRef.URL);
  const revokeObjectURL = windowRef?.URL?.revokeObjectURL?.bind(windowRef.URL);
  const BlobCtor = windowRef?.Blob ?? globalThis.Blob;
  const available = Boolean(
    fileSpace
    && typeof fileSpace.readImagePreview === "function"
    && typeof createObjectURL === "function"
    && typeof revokeObjectURL === "function"
    && typeof BlobCtor === "function"
  );

  const revokeEntry = (entry) => {
    if (entry?.url) revokeObjectURL?.(entry.url);
  };

  const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return false;
    revokeEntry(entry);
    entries.delete(key);
    return true;
  };

  const get = (noteId, reference) => {
    const key = notesImageReferenceKey(noteId, reference);
    const entry = entries.get(key) ?? null;
    if (!entry) return null;
    if (entry.path === reference.path) return entry;
    remove(key);
    return null;
  };

  const ensure = async (noteId, reference, isStillRelated = () => true) => {
    if (destroyed || !available || !isNotesImageReference(reference)) return null;

    const key = notesImageReferenceKey(noteId, reference);
    const existing = get(noteId, reference);
    if (existing?.status === "loading" || existing?.status === "ready" || existing?.status === "failed") {
      return existing;
    }

    const requestId = ++ordinal;
    entries.set(key, Object.freeze({
      path: reference.path,
      status: "loading",
      requestId,
      url: "",
      mime: "",
    }));

    try {
      const preview = validateImagePreview(await fileSpace.readImagePreview(reference.path));
      if (preview.path !== reference.path) {
        throw new TypeError("Image preview path does not match the requested reference");
      }
      const current = entries.get(key);
      if (
        destroyed
        || !current
        || current.requestId !== requestId
        || current.path !== reference.path
      ) {
        return null;
      }

      const url = createObjectURL(new BlobCtor([preview.bytes], { type: preview.mime }));
      if (destroyed || !isStillRelated()) {
        revokeObjectURL(url);
        entries.delete(key);
        return null;
      }

      const ready = Object.freeze({
        path: reference.path,
        status: "ready",
        requestId,
        url,
        mime: preview.mime,
      });
      entries.set(key, ready);
      return ready;
    } catch {
      const current = entries.get(key);
      if (destroyed || !current || current.requestId !== requestId) return null;
      const failed = Object.freeze({
        path: reference.path,
        status: "failed",
        requestId,
        url: "",
        mime: "",
      });
      entries.set(key, failed);
      return failed;
    }
  };

  const releaseExcept = (activeKeys = new Set()) => {
    for (const key of [...entries.keys()]) {
      if (!activeKeys.has(key)) remove(key);
    }
  };

  const clear = () => {
    for (const key of [...entries.keys()]) remove(key);
    ordinal += 1;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clear();
  };

  return Object.freeze({
    available,
    get,
    ensure,
    releaseExcept,
    clear,
    destroy,
  });
}
