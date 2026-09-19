export const NOTES_STATISTICS_SCHEMA = "ordax.notes-statistics/1";

function safeArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value;
}

function textValue(value) {
  if (typeof value !== "string") {
    throw new TypeError("Notes statistics text must be a string");
  }
  return value.replaceAll("\u0000", "");
}

export function countNotesWords(value) {
  const text = textValue(value).trim();
  if (!text) return 0;
  return text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function createNotesStatistics({
  text = "",
  tasks = [],
  references = [],
} = {}) {
  const normalizedText = textValue(text);
  const taskList = safeArray(tasks, "Notes statistics tasks");
  const referenceList = safeArray(references, "Notes statistics references");
  const completedTasks = taskList.reduce(
    (count, task) => count + (task?.done === true ? 1 : 0),
    0,
  );

  return Object.freeze({
    schema: NOTES_STATISTICS_SCHEMA,
    words: countNotesWords(normalizedText),
    characters: [...normalizedText].length,
    tasks: taskList.length,
    completedTasks,
    references: referenceList.length,
  });
}
