import {
  assertNotesFileImporter,
  validateNotesFileImportResult,
} from "../../../contracts/notes-file-importer.mjs";
import { validateFileSpacePath } from "../../../contracts/file-space.mjs";

const FAILURE_MESSAGES = Object.freeze({
  "source-reference-too-long": "O nome ou caminho deste arquivo é longo demais para ser referenciado pelo Notas.",
  "source-read-failed": "Não foi possível ler este arquivo como texto seguro. O arquivo original não foi alterado.",
  "source-mismatch": "A leitura devolveu uma origem diferente da solicitada. Nenhuma nota foi criada.",
  "source-too-large": "Este texto é grande demais para uma nota. O arquivo original não foi alterado.",
  "notes-project-unavailable": "O Notas não tem um projeto local disponível para receber este arquivo.",
  "notes-create-failed": "Não foi possível criar a nota. O arquivo original não foi alterado.",
  "import-in-progress": "Uma nota já está sendo criada a partir de outro arquivo.",
});

function validateFileIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Files to Notes action requires a file identity");
  }
  const path = validateFileSpacePath(value.path);
  if (path === "/") throw new TypeError("Files to Notes action requires a file path");
  if (
    typeof value.name !== "string"
    || value.name.length === 0
    || value.name.length > 512
    || /[\u0000-\u001f\u007f]/.test(value.name)
  ) {
    throw new TypeError("Files to Notes action file name is invalid");
  }
  return Object.freeze({ path, name: value.name });
}

export function createFileNotesActionPresentation({
  importerAvailable,
  busy,
  selected = null,
}) {
  if (typeof importerAvailable !== "boolean" || typeof busy !== "boolean") {
    throw new TypeError("Files to Notes action availability/busy flags must be boolean");
  }
  if (!importerAvailable || selected === null || selected.kind !== "file") {
    return Object.freeze({ visible: false, label: "", disabled: true, title: "" });
  }
  validateFileIdentity(selected);
  return Object.freeze({
    visible: true,
    label: busy ? "Criando nota…" : "Criar nota",
    disabled: busy,
    title: "Cria uma nota com uma cópia do texto e preserva o arquivo original.",
  });
}

export function messageForNotesFileImport(resultValue, fileName) {
  const result = validateNotesFileImportResult(resultValue);
  const name = typeof fileName === "string" && fileName.length > 0 ? fileName : "arquivo";
  if (result.status === "failed") {
    return Object.freeze({
      kind: "warning",
      text: FAILURE_MESSAGES[result.code] ?? "Não foi possível criar a nota.",
      openNotes: false,
    });
  }

  if (result.persistence === "device" && result.persistenceOk) {
    return Object.freeze({
      kind: "success",
      text: `Nota “${name}” criada no Notas. O arquivo original foi preservado.`,
      openNotes: true,
    });
  }
  if (result.persistence === "device") {
    return Object.freeze({
      kind: "warning",
      text: `Nota “${name}” criada, mas a persistência no dispositivo está degradada. O arquivo original foi preservado.`,
      openNotes: true,
    });
  }
  return Object.freeze({
    kind: "neutral",
    text: `Nota “${name}” criada somente nesta sessão. O arquivo original foi preservado.`,
    openNotes: true,
  });
}

export async function importSelectedFileToNotes(importerValue, selectedValue) {
  const importer = assertNotesFileImporter(importerValue);
  const selected = validateFileIdentity(selectedValue);
  let result;
  try {
    result = validateNotesFileImportResult(await importer.importTextFile(selected.path));
  } catch {
    result = Object.freeze({ status: "failed", code: "notes-create-failed" });
  }
  return Object.freeze({
    result,
    presentation: messageForNotesFileImport(result, selected.name),
  });
}
