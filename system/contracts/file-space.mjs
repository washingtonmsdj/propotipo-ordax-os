export const FILE_SPACE_SCHEMA = "ordax.file-space/1";

const ENTRY_KINDS = new Set(["file", "directory"]);

function validatePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("File-space path must be an absolute logical path");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new TypeError("File-space path must not have a trailing slash");
  }
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
  return Object.freeze({ name: value.name, kind: value.kind, size: value.size });
}

export function validateFileListing(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    throw new TypeError("File-space listing is invalid");
  }
  const path = validatePath(value.path);
  const entries = value.entries.map(validateFileEntry);
  return Object.freeze({ path, entries: Object.freeze(entries) });
}

export function assertFileSpacePort(port) {
  if (!port || typeof port !== "object" || port.schema !== FILE_SPACE_SCHEMA) {
    throw new TypeError("A compatible file-space port is required");
  }
  if (typeof port.list !== "function" || typeof port.createDirectory !== "function") {
    throw new TypeError("File-space port must implement list() and createDirectory()");
  }
  return port;
}
