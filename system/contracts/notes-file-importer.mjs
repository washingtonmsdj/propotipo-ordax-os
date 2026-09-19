export const NOTES_FILE_IMPORTER_SCHEMA = "ordax.notes-file-importer/1";

const RESULT_STATUSES = new Set(["created", "failed"]);
const FAILURE_CODES = new Set([
  "source-reference-too-long",
  "source-read-failed",
  "source-mismatch",
  "source-too-large",
  "notes-project-unavailable",
  "notes-create-failed",
  "import-in-progress",
]);

function boundedString(value, name, max = 4096) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function validateNotesFileImportResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notes file import result must be an object");
  }
  if (!RESULT_STATUSES.has(value.status)) {
    throw new TypeError(`Unsupported Notes file import status: ${String(value.status)}`);
  }

  if (value.status === "failed") {
    if (!FAILURE_CODES.has(value.code)) {
      throw new TypeError(`Unsupported Notes file import failure code: ${String(value.code)}`);
    }
    return Object.freeze({ status: "failed", code: value.code });
  }

  const persistence = value.persistence;
  if (persistence !== "device" && persistence !== "session") {
    throw new TypeError("Notes file import persistence must be device or session");
  }
  if (typeof value.persistenceOk !== "boolean") {
    throw new TypeError("Notes file import persistenceOk must be boolean");
  }

  return Object.freeze({
    status: "created",
    noteId: boundedString(value.noteId, "Notes file import noteId", 256),
    projectId: boundedString(value.projectId, "Notes file import projectId", 256),
    sourcePath: boundedString(value.sourcePath, "Notes file import sourcePath"),
    persistence,
    persistenceOk: value.persistenceOk,
  });
}

export function assertNotesFileImporter(port) {
  if (!port || typeof port !== "object" || port.schema !== NOTES_FILE_IMPORTER_SCHEMA) {
    throw new TypeError("A compatible notes-file-importer port is required");
  }
  if (typeof port.importTextFile !== "function") {
    throw new TypeError("Notes-file-importer port must implement importTextFile(path)");
  }
  return port;
}
