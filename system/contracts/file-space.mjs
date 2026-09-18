export const FILE_SPACE_SCHEMA = "ordax.file-space/8";
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_FILE_COPY_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024;

const ENTRY_KINDS = new Set(["file", "directory"]);

function validatePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("File-space path must be an absolute logical path");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new TypeError("File-space path must not have a trailing slash");
  }
  if (path === "/") return path;
  const parts = path.split("/").slice(1);
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new TypeError("File-space path contains an invalid segment");
  }
  return path;
}

export function validateFileEntry(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("File-space entry must be an object");
  }
  if (
    typeof value.name !== "string" ||
    !value.name ||
    value.name === "." ||
    value.name === ".." ||
    value.name.includes("/") ||
    value.name.includes("\0")
  ) {
    throw new TypeError("File-space entry name is invalid");
  }
  if (!ENTRY_KINDS.has(value.kind)) {
    throw new TypeError(`Unsupported file-space entry kind: ${String(value.kind)}`);
  }
  if (!Number.isInteger(value.size) || value.size < 0) {
    throw new TypeError("File-space entry size must be a non-negative integer");
  }
  if (!Number.isSafeInteger(value.modifiedAt) || value.modifiedAt < 0) {
    throw new TypeError("File-space entry modifiedAt must be a non-negative epoch millisecond");
  }
  return Object.freeze({
    name: value.name,
    kind: value.kind,
    size: value.size,
    modifiedAt: value.modifiedAt,
  });
}

export function validateFileListing(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    throw new TypeError("File-space listing is invalid");
  }
  const path = validatePath(value.path);
  const entries = value.entries.map(validateFileEntry);
  return Object.freeze({ path, entries: Object.freeze(entries) });
}

export function validateTextFile(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Text-file payload must be an object");
  }
  const path = validatePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > MAX_TEXT_FILE_BYTES) {
    throw new TypeError("Text-file size is outside the preview boundary");
  }
  if (typeof value.text !== "string" || value.text.includes("\0")) {
    throw new TypeError("Text-file content must be valid text");
  }
  return Object.freeze({ path, size: value.size, text: value.text });
}

export function assertFileSpacePort(port) {
  if (!port || typeof port !== "object" || port.schema !== FILE_SPACE_SCHEMA) {
    throw new TypeError("A compatible file-space port is required");
  }
  if (
    typeof port.list !== "function" ||
    typeof port.createDirectory !== "function" ||
    typeof port.readTextFile !== "function" ||
    typeof port.renameEntry !== "function" ||
    typeof port.copyFile !== "function" ||
    typeof port.moveEntry !== "function" ||
    typeof port.exportFile !== "function" ||
    typeof port.importFile !== "function"
  ) {
    throw new TypeError(
      "File-space port must implement list(), createDirectory(), readTextFile(), renameEntry(), copyFile(), moveEntry(), exportFile(), and importFile()",
    );
  }
  return port;
}
