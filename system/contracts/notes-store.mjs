export const NOTES_STORE_SCHEMA = "ordax.notes-store/1";
export const NOTES_SNAPSHOT_SCHEMA = "ordax.notes-snapshot/2";
export const LEGACY_NOTES_SNAPSHOT_SCHEMA = "ordax.notes-snapshot/1";
export const MAX_NOTES = 512;
export const MAX_NOTE_PROJECTS = 64;
export const MAX_NOTE_REFERENCES = 32;
export const MAX_NOTE_TASKS = 64;
export const MAX_NOTE_TEXT_CHARS = 65536;
export const MAX_NOTE_RICH_BLOCKS = 256;
export const MAX_NOTE_RICH_MARKS_PER_BLOCK = 64;

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const REFERENCE_KINDS = new Set(["link", "file"]);
const RICH_BLOCK_TYPES = new Set(["paragraph", "heading", "quote", "bullet"]);
const RICH_MARK_TYPES = new Set(["bold", "italic", "link"]);

function finiteTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

function boundedText(value, label, max = MAX_NOTE_TEXT_CHARS) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function freezeRichMark(value, textLength) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Rich-text mark is invalid");
  }
  if (!RICH_MARK_TYPES.has(value.type)) {
    throw new TypeError("Rich-text mark type is invalid");
  }
  if (
    !Number.isInteger(value.start)
    || !Number.isInteger(value.end)
    || value.start < 0
    || value.end <= value.start
    || value.end > textLength
  ) {
    throw new TypeError("Rich-text mark range is invalid");
  }
  const href = value.type === "link"
    ? boundedText(value.href ?? "", "Rich-text link", 4096)
    : "";
  if (value.type === "link" && !/^https?:\/\//i.test(href)) {
    throw new TypeError("Rich-text link must use http or https");
  }
  return Object.freeze({
    type: value.type,
    start: value.start,
    end: value.end,
    href,
  });
}

function freezeRichBlock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Rich-text block is invalid");
  }
  if (!RICH_BLOCK_TYPES.has(value.type)) {
    throw new TypeError("Rich-text block type is invalid");
  }
  const text = boundedText(value.text ?? "", "Rich-text block text", MAX_NOTE_TEXT_CHARS);
  const marks = Array.isArray(value.marks) ? value.marks.map((mark) => freezeRichMark(mark, text.length)) : [];
  if (marks.length > MAX_NOTE_RICH_MARKS_PER_BLOCK) {
    throw new TypeError("Rich-text block has too many marks");
  }
  return Object.freeze({
    type: value.type,
    text,
    marks: Object.freeze(marks),
  });
}

export function validateNotesRichBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.blocks)) {
    throw new TypeError("Rich note body is invalid");
  }
  if (value.blocks.length === 0 || value.blocks.length > MAX_NOTE_RICH_BLOCKS) {
    throw new TypeError("Rich note body block count is invalid");
  }
  const blocks = value.blocks.map(freezeRichBlock);
  const plainText = blocks.map((block) => block.text).join("\n");
  boundedText(plainText, "Rich note body text");
  return Object.freeze({ blocks: Object.freeze(blocks) });
}

export function createNotesRichBodyFromPlainText(value) {
  const text = boundedText(value ?? "", "Note body");
  const lines = text.split("\n");
  return validateNotesRichBody({
    blocks: lines.map((line) => ({ type: "paragraph", text: line, marks: [] })),
  });
}

export function notesRichBodyToPlainText(value) {
  const richBody = validateNotesRichBody(value);
  return richBody.blocks.map((block) => block.text).join("\n");
}

function validId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validLogicalFilePath(value) {
  const path = boundedText(value ?? "", "Reference path", 4096);
  if (!path) return "";
  if (!path.startsWith("/") || (path !== "/" && path.endsWith("/"))) {
    throw new TypeError("Reference file path must be an absolute logical path");
  }
  const parts = path.split("/").slice(1);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("Reference file path contains an invalid segment");
  }
  return path;
}

function freezeProject(value) {
  if (!value || typeof value !== "object") throw new TypeError("Note project is invalid");
  return Object.freeze({
    id: validId(value.id, "Project id"),
    name: boundedText(value.name, "Project name", 160),
    createdAt: finiteTimestamp(value.createdAt, "Project createdAt"),
    updatedAt: finiteTimestamp(value.updatedAt, "Project updatedAt"),
  });
}

function freezeTask(value) {
  if (!value || typeof value !== "object") throw new TypeError("Note task is invalid");
  return Object.freeze({
    id: validId(value.id, "Task id"),
    text: boundedText(value.text, "Task text", 2048),
    done: value.done === true,
  });
}

function freezeReference(value) {
  if (!value || typeof value !== "object") throw new TypeError("Note reference is invalid");
  if (!REFERENCE_KINDS.has(value.kind)) throw new TypeError("Note reference kind is invalid");
  const href = value.kind === "link"
    ? boundedText(value.href ?? "", "Reference href", 4096)
    : "";
  const path = value.kind === "file" ? validLogicalFilePath(value.path) : "";
  if (value.kind === "link" && href && !/^https?:\/\//i.test(href)) {
    throw new TypeError("Note reference link must use http or https");
  }
  return Object.freeze({
    id: validId(value.id, "Reference id"),
    kind: value.kind,
    title: boundedText(value.title, "Reference title", 512),
    detail: boundedText(value.detail ?? "", "Reference detail", 1024),
    href,
    path,
  });
}

function freezeNote(value, projectIds) {
  if (!value || typeof value !== "object") throw new TypeError("Note is invalid");
  const projectId = validId(value.projectId, "Note project id");
  if (!projectIds.has(projectId)) throw new TypeError("Note references an unknown project");
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(freezeTask) : [];
  const references = Array.isArray(value.references) ? value.references.map(freezeReference) : [];
  if (tasks.length > MAX_NOTE_TASKS) throw new TypeError("Note has too many tasks");
  if (references.length > MAX_NOTE_REFERENCES) throw new TypeError("Note has too many references");

  const sourceBody = boundedText(value.body ?? "", "Note body");
  const richBody = value.richBody === undefined || value.richBody === null
    ? createNotesRichBodyFromPlainText(sourceBody)
    : validateNotesRichBody(value.richBody);
  const body = richBody.blocks.map((block) => block.text).join("\n");
  if (value.richBody !== undefined && value.richBody !== null && sourceBody !== body) {
    throw new TypeError("Note body and rich body must describe the same text");
  }

  return Object.freeze({
    id: validId(value.id, "Note id"),
    projectId,
    title: boundedText(value.title, "Note title", 1024),
    body,
    richBody,
    favorite: value.favorite === true,
    deletedAt: value.deletedAt === null || value.deletedAt === undefined
      ? null
      : finiteTimestamp(value.deletedAt, "Note deletedAt"),
    createdAt: finiteTimestamp(value.createdAt, "Note createdAt"),
    updatedAt: finiteTimestamp(value.updatedAt, "Note updatedAt"),
    tasks: Object.freeze(tasks),
    references: Object.freeze(references),
  });
}

export function validateNotesSnapshot(value) {
  if (!value || typeof value !== "object") throw new TypeError("Notes snapshot must be an object");
  if (![NOTES_SNAPSHOT_SCHEMA, LEGACY_NOTES_SNAPSHOT_SCHEMA].includes(value.$schema)) {
    throw new TypeError(`Unsupported notes snapshot schema: ${String(value.$schema)}`);
  }
  if (!Array.isArray(value.projects) || !Array.isArray(value.notes)) {
    throw new TypeError("Notes snapshot requires projects and notes arrays");
  }
  if (value.projects.length === 0 || value.projects.length > MAX_NOTE_PROJECTS) {
    throw new TypeError("Notes snapshot project count is invalid");
  }
  if (value.notes.length > MAX_NOTES) throw new TypeError("Notes snapshot has too many notes");

  const projects = value.projects.map(freezeProject);
  const projectIds = new Set(projects.map((project) => project.id));
  if (projectIds.size !== projects.length) throw new TypeError("Note project ids must be unique");

  const notes = value.notes.map((note) => freezeNote(note, projectIds));
  const noteIds = new Set(notes.map((note) => note.id));
  if (noteIds.size !== notes.length) throw new TypeError("Note ids must be unique");

  const selectedProjectId = value.selectedProjectId === null || value.selectedProjectId === undefined
    ? projects[0].id
    : validId(value.selectedProjectId, "Selected project id");
  if (!projectIds.has(selectedProjectId)) throw new TypeError("Selected project does not exist");

  const selectedNoteId = value.selectedNoteId === null || value.selectedNoteId === undefined
    ? null
    : validId(value.selectedNoteId, "Selected note id");
  if (selectedNoteId !== null && !noteIds.has(selectedNoteId)) {
    throw new TypeError("Selected note does not exist");
  }

  return Object.freeze({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId,
    selectedNoteId,
    projects: Object.freeze(projects),
    notes: Object.freeze(notes),
  });
}

export function assertNotesStore(store) {
  if (!store || typeof store !== "object" || store.schema !== NOTES_STORE_SCHEMA) {
    throw new TypeError("A compatible notes store is required");
  }
  if (!["device", "session"].includes(store.scope)) {
    throw new TypeError("Notes store scope must be device or session");
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("Notes store must implement load() and save(snapshot)");
  }
  return store;
}
