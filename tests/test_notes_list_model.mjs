import assert from "node:assert/strict";
import test from "node:test";

import {
  firstNotesBodyLine,
  formatNotesRelativeTime,
  noteMatchesQuery,
  visibleNotes,
} from "../system/surface/ui/notes-list-model.mjs";

function note({
  id,
  projectId = "meu-espaco",
  title = id,
  body = "",
  favorite = false,
  deletedAt = null,
  updatedAt = 1,
  tasks = [],
  references = [],
}) {
  return {
    id,
    projectId,
    title,
    body,
    favorite,
    deletedAt,
    updatedAt,
    tasks,
    references,
  };
}

test("relative time distinguishes minutes from hours", () => {
  const now = Date.UTC(2026, 8, 19, 2, 0, 0);
  assert.equal(formatNotesRelativeTime(now - 15_000, now), "Agora");
  assert.equal(formatNotesRelativeTime(now - 2 * 60_000, now), "2 min");
  assert.equal(formatNotesRelativeTime(now - 59 * 60_000, now), "59 min");
  assert.equal(formatNotesRelativeTime(now - 2 * 3_600_000, now), "2 h");
  assert.equal(formatNotesRelativeTime(now - 30 * 3_600_000, now), "Ontem");
});

test("first body line ignores empty whitespace-only lines", () => {
  assert.equal(firstNotesBodyLine("\n   \nPrimeira ideia\nSegunda"), "Primeira ideia");
  assert.equal(firstNotesBodyLine(""), "Nota sem conteúdo");
  assert.equal(firstNotesBodyLine(null), "Nota sem conteúdo");
});

test("query matches title, body, tasks and reference metadata", () => {
  const candidate = note({
    id: "n1",
    title: "Planejamento",
    body: "Texto principal",
    tasks: [{ text: "Validar orçamento" }],
    references: [{
      title: "Brief",
      detail: "Imagem local",
      href: "",
      path: "/Imagens/referencia.png",
    }],
  });

  assert.equal(noteMatchesQuery(candidate, "planejamento"), true);
  assert.equal(noteMatchesQuery(candidate, "principal"), true);
  assert.equal(noteMatchesQuery(candidate, "orçamento"), true);
  assert.equal(noteMatchesQuery(candidate, "referencia.png"), true);
  assert.equal(noteMatchesQuery(candidate, "inexistente"), false);
});

test("visible notes preserve lifecycle, project, recent and ordering semantics", () => {
  const documentState = {
    selectedProjectId: "projeto-a",
    notes: [
      note({ id: "a1", projectId: "projeto-a", updatedAt: 10 }),
      note({ id: "a2", projectId: "projeto-a", favorite: true, updatedAt: 30 }),
      note({ id: "b1", projectId: "projeto-b", favorite: true, updatedAt: 20 }),
      note({ id: "trash", projectId: "projeto-a", deletedAt: 40, updatedAt: 40 }),
    ],
  };

  assert.deepEqual(
    visibleNotes(documentState, "project", "", true).map((item) => item.id),
    ["a2", "a1"],
  );
  assert.deepEqual(
    visibleNotes(documentState, "favorites", "", true).map((item) => item.id),
    ["a2", "b1"],
  );
  assert.deepEqual(
    visibleNotes(documentState, "trash", "", true).map((item) => item.id),
    ["trash"],
  );
  assert.deepEqual(
    visibleNotes(documentState, "all", "", false).map((item) => item.id),
    ["a1", "b1", "a2"],
  );
});

test("recent mode limits before query and can reverse the retained recent set", () => {
  const notes = Array.from({ length: 35 }, (_, index) => note({
    id: `n-${index + 1}`,
    title: index === 0 ? "alvo muito antigo" : `nota ${index + 1}`,
    updatedAt: index + 1,
  }));
  const documentState = {
    selectedProjectId: "meu-espaco",
    notes,
  };

  assert.equal(visibleNotes(documentState, "recent", "alvo", true).length, 0);
  const recentAscending = visibleNotes(documentState, "recent", "", false);
  assert.equal(recentAscending.length, 30);
  assert.equal(recentAscending[0].id, "n-6");
  assert.equal(recentAscending.at(-1).id, "n-35");
});
