export function formatNotesRelativeTime(timestamp, now = Date.now()) {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return "Agora";
  if (delta < 3_600_000) {
    const minutes = Math.max(1, Math.floor(delta / 60_000));
    return `${minutes} min`;
  }
  if (delta < 86_400_000) {
    const hours = Math.max(1, Math.floor(delta / 3_600_000));
    return `${hours} h`;
  }
  if (delta < 2 * 86_400_000) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(timestamp));
}

export function firstNotesBodyLine(body) {
  return String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "Nota sem conteúdo";
}

export function noteMatchesQuery(note, query) {
  if (!query) return true;
  const normalizedQuery = String(query).toLocaleLowerCase("pt-BR");
  const haystack = [
    note.title,
    note.body,
    ...note.tasks.map((task) => task.text),
    ...note.references.flatMap((reference) => [
      reference.title,
      reference.detail,
      reference.href,
      reference.path ?? "",
    ]),
  ].join("\n").toLocaleLowerCase("pt-BR");
  return haystack.includes(normalizedQuery);
}

export function visibleNotes(documentState, mode, query, newestFirst = true) {
  let items = [...documentState.notes];
  if (mode === "trash") {
    items = items.filter((note) => note.deletedAt !== null);
  } else {
    items = items.filter((note) => note.deletedAt === null);
    if (mode === "favorites") items = items.filter((note) => note.favorite);
    if (mode === "recent") {
      items = items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
    }
    if (mode === "project") {
      items = items.filter((note) => note.projectId === documentState.selectedProjectId);
    }
  }

  return items
    .filter((note) => noteMatchesQuery(note, query))
    .sort((a, b) => newestFirst ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt);
}
