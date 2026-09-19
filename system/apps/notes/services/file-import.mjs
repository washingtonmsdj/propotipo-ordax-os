import {
  assertFileSpacePort,
  validateFileSpacePath,
  validateTextFile,
} from "../../../contracts/file-space.mjs";
import {
  NOTES_FILE_IMPORTER_SCHEMA,
  assertNotesFileImporter,
  validateNotesFileImportResult,
} from "../../../contracts/notes-file-importer.mjs";
import { MAX_NOTE_TEXT_CHARS } from "../../../contracts/notes-store.mjs";
import {
  assertNotesRuntime,
} from "../domain/runtime.mjs";

const MAX_REFERENCE_TITLE_CHARS = 512;
const MAX_REFERENCE_DETAIL_CHARS = 1024;

function result(status, fields = {}) {
  return validateNotesFileImportResult({ status, ...fields });
}

function sourceName(path) {
  const value = validateFileSpacePath(path);
  if (value === "/") throw new TypeError("Notes import source must identify a file");
  return value.slice(value.lastIndexOf("/") + 1);
}

function assertImportCapableNotesRuntime(runtime) {
  const notes = assertNotesRuntime(runtime);
  if (typeof notes.addReference !== "function") {
    throw new TypeError("Notes file import requires addReference(noteId, reference)");
  }
  return notes;
}

export function createNotesFileImporter({ fileSpace, notesRuntime }) {
  const files = assertFileSpacePort(fileSpace);
  const notes = assertImportCapableNotesRuntime(notesRuntime);

  const port = {
    schema: NOTES_FILE_IMPORTER_SCHEMA,

    async importTextFile(pathValue) {
      const path = validateFileSpacePath(pathValue);
      const name = sourceName(path);
      if (name.length > MAX_REFERENCE_TITLE_CHARS || path.length > MAX_REFERENCE_DETAIL_CHARS) {
        return result("failed", { code: "source-reference-too-long" });
      }

      let source;
      try {
        source = validateTextFile(await files.readTextFile(path));
      } catch {
        return result("failed", { code: "source-read-failed" });
      }
      if (source.path !== path) {
        return result("failed", { code: "source-mismatch" });
      }
      if (source.text.length > MAX_NOTE_TEXT_CHARS) {
        return result("failed", { code: "source-too-large" });
      }

      const before = notes.getSnapshot();
      const projectId = before?.document?.selectedProjectId;
      if (typeof projectId !== "string" || projectId.length === 0) {
        return result("failed", { code: "notes-project-unavailable" });
      }

      let created;
      try {
        created = notes.createNote(projectId);
        const noteId = created?.document?.selectedNoteId;
        if (typeof noteId !== "string" || noteId.length === 0) {
          return result("failed", { code: "notes-create-failed" });
        }
        notes.updateNote(noteId, { title: name, body: source.text });
        const finalState = notes.addReference(noteId, {
          kind: "file",
          title: name,
          detail: path,
          path,
        });
        const note = finalState?.document?.notes?.find((candidate) => candidate.id === noteId);
        if (!note || note.title !== name || note.body !== source.text) {
          return result("failed", { code: "notes-create-failed" });
        }
        const reference = note.references.find(
          (candidate) => candidate.kind === "file" && candidate.detail === path,
        );
        if (!reference) {
          return result("failed", { code: "notes-create-failed" });
        }
        return result("created", {
          noteId,
          projectId: note.projectId,
          sourcePath: path,
          persistence: finalState.persistence?.scope ?? "session",
          persistenceOk: finalState.persistence?.ok === true,
        });
      } catch {
        // Runtime/host exception text is never returned to presentation code.
        return result("failed", { code: "notes-create-failed" });
      }
    },
  };

  assertNotesFileImporter(port);
  return Object.freeze(port);
}
