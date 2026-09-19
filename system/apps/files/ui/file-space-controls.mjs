import { assertAppActivationPort } from "../../../contracts/app-activation.mjs";
import {
  MAX_FILE_COPY_BYTES,
  MAX_FILE_EXPORT_BYTES,
  MAX_FILE_IMPORT_BYTES,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../../contracts/file-space.mjs";
import { assertNotesFileImporter } from "../../../contracts/notes-file-importer.mjs";
import {
  assertRecentFilesPort,
  validateRecentFilesSnapshot,
} from "../../../contracts/recent-files.mjs";
import {
  MAX_PROJECT_NAME_LENGTH,
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
} from "../../../contracts/project-catalog.mjs";
import {
  createFileNotesActionPresentation,
  importSelectedFileToNotes,
} from "./file-notes-action.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";

const FILE_WINDOW_SELECTOR = '[data-window-id="files"]';
const FILE_EXTENSION_SELECTOR = '[data-app-extension="file-space"]';
const FILE_SEARCH_LOCALE = "pt-BR";
const MAX_NAVIGATION_HISTORY = 64;
const LOCATIONS = Object.freeze([
  Object.freeze({ label: "Meu espaço", path: "/" }),
  Object.freeze({ label: "Documentos", path: "/Documentos" }),
  Object.freeze({ label: "Imagens", path: "/Imagens" }),
  Object.freeze({ label: "Downloads", path: "/Downloads" }),
]);

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function joinPath(path, name) {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function suggestedCopyName(name) {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    return `${name.slice(0, dot)} - cópia${name.slice(dot)}`;
  }
  return `${name} - cópia`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModifiedAt(epochMilliseconds) {
  return new Intl.DateTimeFormat(FILE_SEARCH_LOCALE, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(epochMilliseconds));
}

function locationIsActive(currentPath, locationPath) {
  if (locationPath === "/") return currentPath === "/";
  return currentPath === locationPath || currentPath.startsWith(`${locationPath}/`);
}

function breadcrumbParts(path) {
  if (path === "/") return [];
  return path.split("/").filter(Boolean);
}

export function mountFileSpaceControls(
  root,
  fileSpace = null,
  appActivation = null,
  surfaceLifecycle = null,
  resources = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("File-space controls require a Surface root Element");
  }
  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  if (!port) {
    return Object.freeze({ destroy() {} });
  }
  const recentFiles = resources?.recentFiles ?? null;
  const projects = resources?.projects ?? null;
  const notesFileImporter = resources?.notesFileImporter ?? null;
  const recentPort = recentFiles === null ? null : assertRecentFilesPort(recentFiles);
  const projectPort = projects === null ? null : assertProjectCatalogPort(projects);
  const notesImporterPort = notesFileImporter === null ? null : assertNotesFileImporter(notesFileImporter);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;

  let listing = null;
  let pending = false;
  let message = null;
  let destroyed = false;
  let requestOrdinal = 0;
  let mountedSlot = null;
  let creatingDirectory = false;
  let directoryDraft = "";
  let textPreview = null;
  let previewPending = false;
  let previewRequestOrdinal = 0;
  let selectedPath = null;
  let renamingPath = null;
  let renameDraft = "";
  let copyingPath = null;
  let copyDraft = "";
  let transferEntry = null;
  let searchQuery = "";
  let sortKey = "name";
  let sortDirection = "asc";
  let navigationHistory = [];
  let navigationIndex = -1;
  let focusRequest = null;
  let recentSnapshot = recentPort?.getSnapshot() ?? null;
  let recentMode = false;
  let selectedRecentPath = null;
  let recentSearchQuery = "";
  let projectSnapshot = projectPort?.getSnapshot() ?? null;
  let creatingProject = false;
  let projectDraft = "";
  let renamingProjectId = null;
  let projectRenameDraft = "";
  let failedProjectResume = null;
  let notesImportPending = false;

  const findSlot = () =>
    root.querySelector(`${FILE_WINDOW_SELECTOR} ${FILE_EXTENSION_SELECTOR}`);

  const interactionContext = () =>
    recentMode ? "recent" : `path:${listing?.path ?? ""}`;

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.fileRecentSearch !== undefined) {
      return Object.freeze({ kind: "recent-search", value: "" });
    }
    if (element.dataset.fileRecentPath) {
      return Object.freeze({ kind: "recent-row", value: element.dataset.fileRecentPath });
    }
    if (element.dataset.fileSearch !== undefined) {
      return Object.freeze({ kind: "search", value: "" });
    }
    if (element.dataset.fileProjectRenameName !== undefined) {
      return Object.freeze({ kind: "project-rename-name", value: renamingProjectId ?? "" });
    }
    if (element.dataset.fileProjectName !== undefined) {
      return Object.freeze({ kind: "project-name", value: "" });
    }
    if (element.dataset.fileDirectoryName !== undefined) {
      return Object.freeze({ kind: "directory-name", value: "" });
    }
    if (element.dataset.fileRenameName !== undefined) {
      return Object.freeze({ kind: "rename-name", value: renamingPath ?? "" });
    }
    if (element.dataset.fileCopyName !== undefined) {
      return Object.freeze({ kind: "copy-name", value: copyingPath ?? "" });
    }
    if (element.dataset.fileSelectPath) {
      return Object.freeze({ kind: "row", value: element.dataset.fileSelectPath });
    }
    if (element.dataset.fileSortKey) {
      return Object.freeze({ kind: "sort", value: element.dataset.fileSortKey });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    for (const element of slot.querySelectorAll("button, input")) {
      const candidate = focusIdentity(element);
      if (
        candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
      ) {
        return element;
      }
    }
    return null;
  };

  const captureInteractionState = (slot) => {
    const windowBody = slot.closest(".ordax-window-body");
    const list = slot.querySelector(".ordax-files-list");
    const preview = slot.querySelector(".ordax-files-preview-content");
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && slot.contains(activeElement);
    const identity = activeInside ? focusIdentity(activeElement) : null;
    const selection =
      activeInside
      && activeElement instanceof HTMLInputElement
      && identity
        ? Object.freeze({
            identity,
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd,
          })
        : null;
    return Object.freeze({
      context: slot.dataset.fileSpaceContext ?? "",
      windowScrollTop: windowBody?.scrollTop ?? 0,
      windowScrollLeft: windowBody?.scrollLeft ?? 0,
      listScrollTop: list?.scrollTop ?? 0,
      listScrollLeft: list?.scrollLeft ?? 0,
      previewScrollTop: preview?.scrollTop ?? 0,
      previewScrollLeft: preview?.scrollLeft ?? 0,
      focus: identity,
      selection,
    });
  };

  const requestFocus = (kind, value = "") => {
    focusRequest = Object.freeze({ kind, value });
  };

  const restoreInteractionState = (slot, snapshot) => {
    const sameContext =
      Boolean(snapshot)
      && snapshot.context === interactionContext();
    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody && sameContext) {
      windowBody.scrollTop = snapshot.windowScrollTop;
      windowBody.scrollLeft = snapshot.windowScrollLeft;
    }

    const list = slot.querySelector(".ordax-files-list");
    if (list && sameContext) {
      list.scrollTop = snapshot.listScrollTop;
      list.scrollLeft = snapshot.listScrollLeft;
    }

    const preview = slot.querySelector(".ordax-files-preview-content");
    if (preview && sameContext) {
      preview.scrollTop = snapshot.previewScrollTop;
      preview.scrollLeft = snapshot.previewScrollLeft;
    }

    const requested = focusRequest;
    focusRequest = null;
    const identity = requested ?? (sameContext ? snapshot?.focus : null) ?? null;
    const target = findFocusTarget(slot, identity);
    if (!target || target.disabled) return;

    target.focus({ preventScroll: true });
    if (!(target instanceof HTMLInputElement)) return;

    const savedSelection =
      sameContext
      && snapshot?.selection
      && snapshot.selection.identity.kind === identity.kind
      && snapshot.selection.identity.value === identity.value
        ? snapshot.selection
        : null;
    if (savedSelection?.start !== null && savedSelection?.end !== null) {
      const length = target.value.length;
      target.setSelectionRange(
        Math.min(savedSelection.start, length),
        Math.min(savedSelection.end, length),
      );
      return;
    }

    if (requested) {
      const caret = target.value.length;
      target.setSelectionRange?.(caret, caret);
    }
  };

  const renderLocations = (container) => {
    const heading = node(documentObject, "p", "ordax-files-section-label", "Locais");
    container.append(heading);
    LOCATIONS.forEach((location, index) => {
      const button = node(documentObject, "button", "ordax-files-location", location.label);
      button.type = "button";
      button.dataset.fileOpenPath = location.path;
      const active = Boolean(
        !recentMode && listing && locationIsActive(listing.path, location.path),
      );
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      container.append(button);

      if (index === 0 && recentPort) {
        const recent = node(documentObject, "button", "ordax-files-location", "Recentes");
        recent.type = "button";
        recent.dataset.fileOpenRecent = "";
        recent.dataset.active = String(recentMode);
        recent.setAttribute("aria-current", recentMode ? "page" : "false");
        container.append(recent);
      }
    });

    if (projectPort) {
      container.append(node(documentObject, "p", "ordax-files-section-label", "Projetos"));
      for (const project of projectSnapshot?.projects ?? []) {
        const button = node(documentObject, "button", "ordax-files-location", project.name);
        button.type = "button";
        button.dataset.fileOpenProject = project.id;
        button.title = project.path;
        const active = Boolean(!recentMode && listing?.path === project.path);
        button.dataset.active = String(active);
        button.setAttribute("aria-current", active ? "page" : "false");
        container.append(button);
      }
    }
  };

  const parentPath = (path) => {
    if (typeof path !== "string" || path === "/") return "/";
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    return parts.length === 0 ? "/" : `/${parts.join("/")}`;
  };

  const projectForFilePath = (path) => {
    if (!projectPort || typeof path !== "string") return null;
    let match = null;
    for (const project of projectSnapshot?.projects ?? []) {
      if (!path.startsWith(`${project.path}/`)) continue;
      if (!match || project.path.length > match.path.length) match = project;
    }
    return match;
  };

  const canGoBack = () => navigationIndex > 0;
  const canGoForward = () =>
    navigationIndex >= 0 && navigationIndex < navigationHistory.length - 1;

  const recordNavigation = (path) => {
    if (navigationHistory[navigationIndex] === path) return;
    navigationHistory = navigationHistory.slice(0, navigationIndex + 1);
    navigationHistory.push(path);
    if (navigationHistory.length > MAX_NAVIGATION_HISTORY) {
      navigationHistory = navigationHistory.slice(-MAX_NAVIGATION_HISTORY);
    }
    navigationIndex = navigationHistory.length - 1;
  };

  const renderBreadcrumb = (container) => {
    const rootButton = node(documentObject, "button", "ordax-files-crumb", "Meu espaço");
    rootButton.type = "button";
    rootButton.dataset.fileOpenPath = "/";
    container.append(rootButton);

    let current = "";
    for (const part of breadcrumbParts(listing?.path ?? "/")) {
      container.append(node(documentObject, "span", "ordax-files-crumb-separator", "/"));
      current += `/${part}`;
      const button = node(documentObject, "button", "ordax-files-crumb", part);
      button.type = "button";
      button.dataset.fileOpenPath = current;
      container.append(button);
    }
  };

  const renderCreateDirectory = (container) => {
    if (!creatingDirectory) return;
    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.placeholder = "Nome da nova pasta";
    input.value = directoryDraft;
    input.dataset.fileDirectoryName = "";
    input.setAttribute("aria-label", "Nome da nova pasta");
    const confirm = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", "Criar");
    confirm.type = "button";
    confirm.dataset.fileCreateDirectory = "";
    confirm.disabled = pending;
    const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
    cancel.type = "button";
    cancel.dataset.fileCreateCancel = "";
    cancel.disabled = pending;
    form.append(input, confirm, cancel);
    container.append(form);
  };

  const renderCreateProject = (container) => {
    if (!creatingProject || !projectPort || !listing || recentMode) return;
    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = MAX_PROJECT_NAME_LENGTH;
    input.autocomplete = "off";
    input.placeholder = "Nome do projeto";
    input.value = projectDraft;
    input.dataset.fileProjectName = "";
    input.setAttribute("aria-label", "Nome do projeto");
    const confirm = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", "Adicionar");
    confirm.type = "button";
    confirm.dataset.fileProjectCreate = "";
    const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
    cancel.type = "button";
    cancel.dataset.fileProjectCreateCancel = "";
    form.append(input, confirm, cancel);
    container.append(form);
  };

  const renderRenameProject = (container) => {
    if (!renamingProjectId || !projectPort || !listing || recentMode) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === renamingProjectId);
    if (!project || project.path !== listing.path) return;

    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = MAX_PROJECT_NAME_LENGTH;
    input.autocomplete = "off";
    input.placeholder = "Novo nome do projeto";
    input.value = projectRenameDraft;
    input.dataset.fileProjectRenameName = "";
    input.setAttribute("aria-label", `Novo nome do projeto ${project.name}`);

    const confirm = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      "Salvar nome",
    );
    confirm.type = "button";
    confirm.dataset.fileProjectRenameConfirm = "";

    const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
    cancel.type = "button";
    cancel.dataset.fileProjectRenameCancel = "";

    const note = node(
      documentObject,
      "p",
      "ordax-files-boundary",
      `Isso altera apenas o nome do projeto. A pasta continua em ${project.path}.`,
    );
    form.append(input, confirm, cancel, note);
    container.append(form);
  };

  const selectedEntry = () => {
    if (!listing || !selectedPath) return null;
    const entry = listing.entries.find((candidate) => joinPath(listing.path, candidate.name) === selectedPath);
    return entry ? Object.freeze({ ...entry, path: selectedPath }) : null;
  };

  const focusSelectedRow = () => {
    if (!selectedPath) return;
    queueMicrotask(() => {
      if (destroyed) return;
      const slot = findSlot();
      const row = slot?.querySelector("[data-file-select-path]");
      if (!row) return;
      for (const candidate of slot.querySelectorAll("[data-file-select-path]")) {
        if (candidate.dataset.fileSelectPath === selectedPath) {
          candidate.focus();
          return;
        }
      }
    });
  };

  const selectPath = (path, { focus = false } = {}) => {
    if (!listing || typeof path !== "string") return;
    const entry = listing.entries.find((candidate) => joinPath(listing.path, candidate.name) === path);
    if (!entry) return;
    selectedPath = path;
    if (renamingPath !== path) {
      renamingPath = null;
      renameDraft = "";
    }
    if (copyingPath !== path) {
      copyingPath = null;
      copyDraft = "";
    }
    message = null;
    if (textPreview?.path !== path) {
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
    }
    replaceView();
    if (focus) focusSelectedRow();
  };

  const normalizedSearchQuery = () =>
    searchQuery.trim().toLocaleLowerCase(FILE_SEARCH_LOCALE);

  const compareEntryNames = (left, right) =>
    left.name.localeCompare(right.name, FILE_SEARCH_LOCALE, {
      numeric: true,
      sensitivity: "base",
    });

  const visibleEntries = () => {
    if (!listing) return [];
    const query = normalizedSearchQuery();
    const filtered = query
      ? listing.entries.filter((entry) =>
          entry.name.toLocaleLowerCase(FILE_SEARCH_LOCALE).includes(query),
        )
      : [...listing.entries];

    const direction = sortDirection === "desc" ? -1 : 1;
    filtered.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      let compared = 0;
      if (sortKey === "type") {
        compared = left.kind.localeCompare(right.kind, "en");
      } else if (sortKey === "size") {
        compared = left.size - right.size;
      } else if (sortKey === "modified") {
        compared = left.modifiedAt - right.modifiedAt;
      } else {
        compared = compareEntryNames(left, right);
      }
      if (compared === 0) compared = compareEntryNames(left, right);
      return compared * direction;
    });
    return filtered;
  };

  const changeSort = (key) => {
    if (!["name", "type", "size", "modified"].includes(key)) return;
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDirection = "asc";
    }
    replaceView();
  };

  const sortButton = (label, key) => {
    const button = node(documentObject, "button", "ordax-files-sort");
    button.type = "button";
    button.dataset.fileSortKey = key;
    const active = sortKey === key;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute(
      "aria-label",
      active
        ? `${label}, ordenação ${sortDirection === "asc" ? "crescente" : "decrescente"}`
        : `Ordenar por ${label.toLocaleLowerCase(FILE_SEARCH_LOCALE)}`,
    );
    button.append(
      node(documentObject, "span", "", label),
      node(
        documentObject,
        "span",
        "ordax-files-sort-indicator",
        active ? (sortDirection === "asc" ? "↑" : "↓") : "",
      ),
    );
    return button;
  };

  const selectionIsVisible = () => {
    if (!listing || !selectedPath) return true;
    return visibleEntries().some(
      (entry) => joinPath(listing.path, entry.name) === selectedPath,
    );
  };

  const operationStatus = (error) => {
    if (Number.isInteger(error?.status)) return error.status;
    const detail = error instanceof Error ? error.message : String(error);
    const match = detail.match(/\b(4\d\d|5\d\d)\b/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const transferDestinationState = () => {
    if (!transferEntry || !listing) {
      return Object.freeze({ allowed: false, reason: "Escolha uma pasta de destino." });
    }
    if (listing.path === transferEntry.sourcePath) {
      return Object.freeze({
        allowed: false,
        reason:
          transferEntry.mode === "copy"
            ? "Escolha outra pasta para copiar este arquivo."
            : "O item já está nesta pasta. Escolha outra pasta.",
      });
    }
    if (
      transferEntry.mode === "move" &&
      transferEntry.kind === "directory" &&
      (listing.path === transferEntry.sourceFullPath ||
        listing.path.startsWith(`${transferEntry.sourceFullPath}/`))
    ) {
      return Object.freeze({
        allowed: false,
        reason: "Uma pasta não pode ser movida para dentro dela mesma.",
      });
    }
    return Object.freeze({ allowed: true, reason: "" });
  };

  const renderTransferOperation = (container) => {
    if (!transferEntry) return;
    const destination = transferDestinationState();
    const isCopy = transferEntry.mode === "copy";
    const verb = isCopy ? "Copiando" : "Movendo";
    const panel = node(documentObject, "section", "ordax-files-transfer");
    panel.setAttribute("aria-label", isCopy ? "Copiar arquivo" : "Mover item");

    const summary = node(documentObject, "div", "ordax-files-transfer-copy");
    summary.append(
      node(documentObject, "strong", "ordax-files-transfer-title", `${verb} “${transferEntry.name}”`),
      node(
        documentObject,
        "span",
        "ordax-files-transfer-meta",
        listing ? `Destino atual: ${listing.path}` : "Abrindo destino…",
      ),
      node(
        documentObject,
        "span",
        "ordax-files-transfer-guidance",
        destination.allowed
          ? isCopy
            ? "Confirme para copiar sem substituir itens existentes."
            : "Confirme para mover sem substituir itens existentes."
          : destination.reason,
      ),
    );

    const actions = node(documentObject, "div", "ordax-files-transfer-actions");
    const confirm = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      isCopy ? "Copiar para esta pasta" : "Mover para esta pasta",
    );
    confirm.type = "button";
    confirm.dataset.fileTransferConfirm = "";
    confirm.disabled = pending || !destination.allowed;

    const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
    cancel.type = "button";
    cancel.dataset.fileTransferCancel = "";
    cancel.disabled = pending;

    actions.append(confirm, cancel);
    panel.append(summary, actions);
    container.append(panel);
  };

  const renderEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    list.setAttribute("aria-label", "Itens da pasta");
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      sortButton("Nome", "name"),
      sortButton("Tipo", "type"),
      sortButton("Tamanho", "size"),
      sortButton("Modificado", "modified"),
    );
    list.append(header);

    if (!listing) {
      const empty = node(
        documentObject,
        "div",
        "ordax-files-empty",
        pending ? "Abrindo espaço do usuário…" : "Espaço do usuário indisponível.",
      );
      list.append(empty);
      container.append(list);
      return;
    }

    if (listing.entries.length === 0) {
      list.append(node(documentObject, "div", "ordax-files-empty", "Esta pasta está vazia."));
      container.append(list);
      return;
    }

    const entries = visibleEntries();
    if (entries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          "Nenhum item corresponde à busca nesta pasta.",
        ),
      );
      container.append(list);
      return;
    }

    for (const entry of entries) {
      const path = joinPath(listing.path, entry.name);
      const selected = selectedPath === path;
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      row.dataset.fileSelectPath = path;
      row.dataset.kind = entry.kind;
      row.dataset.selected = String(selected);
      row.setAttribute("aria-pressed", String(selected));
      row.setAttribute(
        "aria-label",
        selected
          ? `${entry.name}, ${entry.kind === "directory" ? "pasta" : "arquivo"}, selecionado`
          : `${entry.name}, ${entry.kind === "directory" ? "pasta" : "arquivo"}`,
      );

      const nameCell = node(documentObject, "span", "ordax-file-name");
      const icon = node(documentObject, "span", "ordax-file-icon");
      icon.dataset.kind = entry.kind;
      icon.setAttribute("aria-hidden", "true");
      nameCell.append(icon, node(documentObject, "span", "", entry.name));

      row.append(
        nameCell,
        node(documentObject, "span", "ordax-file-meta", entry.kind === "directory" ? "Pasta" : "Arquivo"),
        node(documentObject, "span", "ordax-file-meta", entry.kind === "directory" ? "—" : formatSize(entry.size)),
        node(documentObject, "span", "ordax-file-meta", formatModifiedAt(entry.modifiedAt)),
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderSelectionDetails = (container) => {
    if (transferEntry) return;
    const selected = selectedEntry();
    if (!selected) return;

    const details = node(documentObject, "section", "ordax-files-details");
    details.setAttribute("aria-label", "Detalhes do item selecionado");

    const summary = node(documentObject, "div", "ordax-files-details-summary");
    summary.append(
      node(documentObject, "strong", "ordax-files-details-title", selected.name),
      node(
        documentObject,
        "span",
        "ordax-files-details-meta",
        selected.kind === "directory" ? "Pasta" : `Arquivo · ${formatSize(selected.size)}`,
      ),
      node(documentObject, "span", "ordax-files-details-path", selected.path),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        `Modificado: ${formatModifiedAt(selected.modifiedAt)}`,
      ),
    );

    const actions = node(documentObject, "div", "ordax-files-details-actions");
    const itemBusy = pending || previewPending || notesImportPending;
    let duplicate = null;
    let copyTo = null;
    let exportFile = null;
    let createNote = null;
    if (selected.kind === "file") {
      duplicate = node(documentObject, "button", "ordax-files-action", "Duplicar");
      duplicate.type = "button";
      duplicate.dataset.fileCopyToggle = "";
      duplicate.disabled = itemBusy;
      copyTo = node(documentObject, "button", "ordax-files-action", "Copiar para…");
      copyTo.type = "button";
      copyTo.dataset.fileCopyToToggle = "";
      copyTo.disabled = itemBusy || selected.size > MAX_FILE_COPY_BYTES;
      if (selected.size > MAX_FILE_COPY_BYTES) {
        copyTo.title = "Cópia limitada a 64 MiB";
      }
      exportFile = node(documentObject, "button", "ordax-files-action", "Exportar");
      exportFile.type = "button";
      exportFile.dataset.fileExport = "";
      exportFile.disabled = itemBusy || selected.size > MAX_FILE_EXPORT_BYTES;
      if (selected.size > MAX_FILE_EXPORT_BYTES) {
        exportFile.title = "Exportação rápida limitada a 64 MiB";
      }
      const notesAction = createFileNotesActionPresentation({
        importerAvailable: Boolean(notesImporterPort),
        busy: notesImportPending,
        selected,
      });
      if (notesAction.visible) {
        createNote = node(documentObject, "button", "ordax-files-action", notesAction.label);
        createNote.type = "button";
        createNote.dataset.fileCreateNote = "";
        createNote.disabled = itemBusy || notesAction.disabled;
        createNote.title = notesAction.title;
      }
    }
    const move = node(documentObject, "button", "ordax-files-action", "Mover");
    move.type = "button";
    move.dataset.fileMoveToggle = "";
    move.disabled = itemBusy;
    const rename = node(documentObject, "button", "ordax-files-action", "Renomear");
    rename.type = "button";
    rename.dataset.fileRenameToggle = "";
    rename.disabled = itemBusy;
    const open = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      selected.kind === "directory" ? "Abrir pasta" : "Visualizar texto",
    );
    open.type = "button";
    open.dataset.fileActivateSelected = "";
    open.disabled = itemBusy;
    if (duplicate) actions.append(duplicate);
    if (copyTo) actions.append(copyTo);
    if (exportFile) actions.append(exportFile);
    if (createNote) actions.append(createNote);
    actions.append(move, rename, open);

    details.append(summary, actions);
    container.append(details);

    if (copyingPath === selected.path && selected.kind === "file") {
      const form = node(documentObject, "div", "ordax-files-copy");
      const input = node(documentObject, "input", "ordax-files-copy-input");
      input.type = "text";
      input.maxLength = 255;
      input.autocomplete = "off";
      input.value = copyDraft;
      input.dataset.fileCopyName = "";
      input.setAttribute("aria-label", `Nome da cópia de ${selected.name}`);

      const confirm = node(
        documentObject,
        "button",
        "ordax-files-action ordax-files-action-primary",
        "Criar cópia",
      );
      confirm.type = "button";
      confirm.dataset.fileCopyConfirm = "";
      confirm.disabled = pending;

      const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
      cancel.type = "button";
      cancel.dataset.fileCopyCancel = "";
      cancel.disabled = pending;

      form.append(input, confirm, cancel);
      container.append(form);
    }

    if (renamingPath === selected.path) {
      const form = node(documentObject, "div", "ordax-files-rename");
      const input = node(documentObject, "input", "ordax-files-rename-input");
      input.type = "text";
      input.maxLength = 255;
      input.autocomplete = "off";
      input.value = renameDraft;
      input.dataset.fileRenameName = "";
      input.setAttribute("aria-label", `Novo nome para ${selected.name}`);

      const confirm = node(
        documentObject,
        "button",
        "ordax-files-action ordax-files-action-primary",
        "Salvar nome",
      );
      confirm.type = "button";
      confirm.dataset.fileRenameConfirm = "";
      confirm.disabled = pending;

      const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
      cancel.type = "button";
      cancel.dataset.fileRenameCancel = "";
      cancel.disabled = pending;

      form.append(input, confirm, cancel);
      container.append(form);
    }
  };

  const renderTextPreview = (container) => {
    if (!previewPending && !textPreview) return;
    const preview = node(documentObject, "section", "ordax-files-preview");
    preview.setAttribute("aria-label", "Visualização do arquivo");

    if (previewPending) {
      const loading = node(documentObject, "div", "ordax-files-preview-loading", "Abrindo arquivo…");
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-live", "polite");
      preview.append(loading);
      container.append(preview);
      return;
    }

    const header = node(documentObject, "header", "ordax-files-preview-header");
    const identity = node(documentObject, "div", "ordax-files-preview-identity");
    const parts = textPreview.path.split("/");
    const name = parts[parts.length - 1] || textPreview.path;
    identity.append(
      node(documentObject, "strong", "ordax-files-preview-title", name),
      node(documentObject, "span", "ordax-files-preview-meta", `${formatSize(textPreview.size)} · somente leitura`),
    );
    const close = node(documentObject, "button", "ordax-files-action", "Fechar");
    close.type = "button";
    close.dataset.filePreviewClose = "";
    header.append(identity, close);

    const content = node(documentObject, "pre", "ordax-files-preview-content", textPreview.text);
    content.tabIndex = 0;
    const note = node(
      documentObject,
      "p",
      "ordax-files-preview-note",
      "Visualização segura de texto UTF-8, limitada a 256 KB. O conteúdo não é executado.",
    );
    preview.append(header, content, note);
    container.append(preview);
  };

  const visibleRecentEntries = () => {
    const entries = recentSnapshot?.entries ?? [];
    const query = recentSearchQuery.trim().toLocaleLowerCase(FILE_SEARCH_LOCALE);
    if (!query) return [...entries];
    return entries.filter((entry) =>
      entry.name.toLocaleLowerCase(FILE_SEARCH_LOCALE).includes(query)
      || entry.path.toLocaleLowerCase(FILE_SEARCH_LOCALE).includes(query),
    );
  };

  const selectedRecentEntry = () =>
    recentSnapshot?.entries.find((entry) => entry.path === selectedRecentPath) ?? null;

  const renderRecentEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    list.setAttribute("aria-label", "Arquivos recentes");
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      node(documentObject, "span", "", "Nome"),
      node(documentObject, "span", "", "Tipo"),
      node(documentObject, "span", "", "Local"),
      node(documentObject, "span", "", "Aberto"),
    );
    list.append(header);

    const allEntries = recentSnapshot?.entries ?? [];
    const entries = visibleRecentEntries();
    if (allEntries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          "Nenhum arquivo foi aberto recentemente pelo OrdaX.",
        ),
      );
      container.append(list);
      return;
    }
    if (entries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          "Nenhum arquivo recente corresponde à busca.",
        ),
      );
      container.append(list);
      return;
    }

    for (const entry of entries) {
      const selected = selectedRecentPath === entry.path;
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      row.dataset.fileRecentPath = entry.path;
      row.dataset.kind = "file";
      row.dataset.selected = String(selected);
      row.setAttribute("aria-pressed", String(selected));
      row.setAttribute(
        "aria-label",
        selected ? `${entry.name}, arquivo recente, selecionado` : `${entry.name}, arquivo recente`,
      );

      const nameCell = node(documentObject, "span", "ordax-file-name");
      const icon = node(documentObject, "span", "ordax-file-icon");
      icon.dataset.kind = "file";
      icon.setAttribute("aria-hidden", "true");
      nameCell.append(icon, node(documentObject, "span", "", entry.name));
      row.append(
        nameCell,
        node(documentObject, "span", "ordax-file-meta", "Arquivo"),
        node(documentObject, "span", "ordax-file-meta", parentPath(entry.path)),
        node(documentObject, "span", "ordax-file-meta", formatModifiedAt(entry.openedAt)),
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderRecentDetails = (container) => {
    const selected = selectedRecentEntry();
    if (!selected) return;
    const details = node(documentObject, "section", "ordax-files-details");
    details.setAttribute("aria-label", "Detalhes do arquivo recente selecionado");
    const summary = node(documentObject, "div", "ordax-files-details-summary");
    summary.append(
      node(documentObject, "strong", "ordax-files-details-title", selected.name),
      node(documentObject, "span", "ordax-files-details-meta", "Arquivo aberto pelo OrdaX"),
      node(documentObject, "span", "ordax-files-details-path", selected.path),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        `Aberto: ${formatModifiedAt(selected.openedAt)}`,
      ),
    );
    const actions = node(documentObject, "div", "ordax-files-details-actions");
    const open = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      "Abrir",
    );
    open.type = "button";
    open.dataset.fileRecentOpen = "";
    open.disabled = previewPending;
    const reveal = node(documentObject, "button", "ordax-files-action", "Mostrar na pasta");
    reveal.type = "button";
    reveal.dataset.fileRecentReveal = "";
    reveal.disabled = pending || previewPending;
    const remove = node(documentObject, "button", "ordax-files-action", "Remover da lista");
    remove.type = "button";
    remove.dataset.fileRecentRemove = "";
    remove.disabled = previewPending;
    actions.append(open, reveal, remove);
    details.append(summary, actions);
    container.append(details);
  };

  const renderRecentContent = (content) => {
    const toolbar = node(documentObject, "header", "ordax-files-toolbar");
    const title = node(documentObject, "div", "ordax-files-breadcrumb");
    title.append(node(documentObject, "strong", "", "Recentes"));

    const search = node(documentObject, "div", "ordax-files-search");
    const searchInput = node(documentObject, "input", "ordax-files-search-input");
    searchInput.type = "search";
    searchInput.maxLength = 120;
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = "Buscar nos recentes";
    searchInput.value = recentSearchQuery;
    searchInput.dataset.fileRecentSearch = "";
    searchInput.setAttribute("aria-label", "Buscar nos arquivos recentes");
    search.append(searchInput);
    if (recentSearchQuery) {
      const clearSearch = node(documentObject, "button", "ordax-files-search-clear", "Limpar");
      clearSearch.type = "button";
      clearSearch.dataset.fileRecentSearchClear = "";
      search.append(clearSearch);
    }

    const actions = node(documentObject, "div", "ordax-files-actions");
    const clearHistory = node(documentObject, "button", "ordax-files-action", "Limpar histórico");
    clearHistory.type = "button";
    clearHistory.dataset.fileRecentClear = "";
    clearHistory.disabled = (recentSnapshot?.entries.length ?? 0) === 0 || previewPending;
    actions.append(clearHistory);
    toolbar.append(title, search, actions);
    content.append(toolbar);

    const allEntries = recentSnapshot?.entries ?? [];
    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      `${recentSearchQuery ? `${visibleRecentEntries().length} de ` : ""}${allEntries.length} ${allEntries.length === 1 ? "arquivo" : "arquivos"} · ${recentSnapshot?.persistence === "device" ? "histórico salvo neste dispositivo" : "histórico somente nesta sessão"}`,
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);
    if (message) content.append(node(documentObject, "p", "ordax-files-message", message));
    renderRecentEntries(content);
    renderRecentDetails(content);
    renderTextPreview(content);
    content.append(
      node(
        documentObject,
        "p",
        "ordax-files-boundary",
        "Recentes registra somente arquivos abertos pelo OrdaX. Remover ou limpar este histórico não apaga arquivos.",
      ),
    );
  };

  const createProject = () => {
    if (!projectPort || !listing || listing.path === "/" || pending) return;
    try {
      projectSnapshot = projectPort.create({ name: projectDraft, path: listing.path });
      creatingProject = false;
      projectDraft = "";
      message = "Projeto adicionado. A pasta e os arquivos permanecem no Meu espaço.";
    } catch {
      message = "Não foi possível adicionar esta pasta como projeto.";
    }
    replaceView();
  };

  const renameProject = () => {
    if (!projectPort || !renamingProjectId || !listing) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === renamingProjectId);
    if (!project || project.path !== listing.path) {
      renamingProjectId = null;
      projectRenameDraft = "";
      message = "Este projeto não está mais disponível nesta pasta.";
      replaceView();
      return;
    }
    try {
      projectSnapshot = projectPort.rename(renamingProjectId, projectRenameDraft);
      const renamed = projectSnapshot.projects.find((candidate) => candidate.id === project.id);
      renamingProjectId = null;
      projectRenameDraft = "";
      message = `Projeto renomeado para “${renamed?.name ?? project.name}”. A pasta continua em ${project.path}.`;
    } catch {
      message = "Não foi possível renomear este projeto.";
    }
    replaceView();
  };

  const openProject = async (projectId) => {
    if (!projectPort) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    const loaded = await load(project.path);
    if (destroyed) return;
    if (!loaded) {
      message = "A pasta vinculada a este projeto não está disponível. A referência foi preservada.";
      replaceView();
      return;
    }
    try {
      projectSnapshot = projectPort.recordOpened(projectId);
    } catch {
      message = "A pasta foi aberta, mas a atividade do projeto não pôde ser atualizada.";
      replaceView();
    }
  };

  const removeProject = (projectId) => {
    if (!projectPort) return;
    try {
      projectSnapshot = projectPort.remove(projectId);
      if (renamingProjectId === projectId) {
        renamingProjectId = null;
        projectRenameDraft = "";
      }
      if (failedProjectResume?.projectId === projectId) {
        failedProjectResume = null;
      }
      message = "Projeto removido do catálogo. Nenhum arquivo foi apagado.";
    } catch {
      message = "Não foi possível remover este projeto do catálogo.";
    }
    replaceView();
  };

  const clearFailedProjectResume = (projectId) => {
    if (!projectPort || !failedProjectResume || failedProjectResume.projectId !== projectId) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.lastFilePath !== failedProjectResume.path) {
      failedProjectResume = null;
      message = "A referência do último arquivo mudou. Nada foi alterado.";
      replaceView();
      return;
    }
    try {
      projectSnapshot = projectPort.clearLastFile(projectId);
      failedProjectResume = null;
      message = "Referência do último arquivo esquecida. Nenhum arquivo foi apagado.";
    } catch {
      message = "Não foi possível esquecer a referência do último arquivo.";
    }
    replaceView();
  };

  const enterRecentMode = () => {
    if (!recentPort) return;
    requestOrdinal += 1;
    pending = false;
    recentMode = true;
    selectedRecentPath = null;
    message = null;
    transferEntry = null;
    creatingDirectory = false;
    creatingProject = false;
    projectDraft = "";
    renamingProjectId = null;
    projectRenameDraft = "";
    failedProjectResume = null;
    renamingPath = null;
    copyingPath = null;
    previewRequestOrdinal += 1;
    previewPending = false;
    textPreview = null;
    replaceView();
  };

  const revealRecent = async () => {
    const selected = selectedRecentEntry();
    if (!selected) return;
    const targetPath = selected.path;
    recentMode = false;
    selectedRecentPath = null;
    previewRequestOrdinal += 1;
    previewPending = false;
    textPreview = null;
    const loaded = await load(parentPath(targetPath));
    if (destroyed || !loaded) return;
    const exists = listing?.entries.some(
      (entry) => joinPath(listing.path, entry.name) === targetPath,
    );
    if (exists) {
      selectPath(targetPath, { focus: true });
      return;
    }
    selectedPath = null;
    message = "Arquivo não encontrado. A referência pode ser removida de Recentes.";
    replaceView();
  };

  const paint = (slot, interaction = null) => {
    slot.replaceChildren();
    slot.dataset.ordaxFileSpaceView = "";
    slot.dataset.fileSpacePath = recentMode ? "" : (listing?.path ?? "");
    slot.dataset.fileSpaceContext = interactionContext();

    const view = node(documentObject, "div", "ordax-files-view");
    const locations = node(documentObject, "nav", "ordax-files-locations");
    locations.setAttribute("aria-label", "Locais de arquivos");
    renderLocations(locations);

    const content = node(documentObject, "section", "ordax-files-content");
    if (recentMode) {
      renderRecentContent(content);
      view.append(locations, content);
      slot.append(view);
      restoreInteractionState(slot, interaction);
      return;
    }
    const toolbar = node(documentObject, "header", "ordax-files-toolbar");
    const navigation = node(documentObject, "div", "ordax-files-navigation");

    const back = node(documentObject, "button", "ordax-files-nav-action", "←");
    back.type = "button";
    back.dataset.fileHistoryBack = "";
    back.setAttribute("aria-label", "Voltar");
    back.title = "Voltar";
    back.disabled = pending || !canGoBack();

    const forward = node(documentObject, "button", "ordax-files-nav-action", "→");
    forward.type = "button";
    forward.dataset.fileHistoryForward = "";
    forward.setAttribute("aria-label", "Avançar");
    forward.title = "Avançar";
    forward.disabled = pending || !canGoForward();

    const up = node(documentObject, "button", "ordax-files-nav-action", "↑");
    up.type = "button";
    up.dataset.fileHistoryUp = "";
    up.setAttribute("aria-label", "Subir um nível");
    up.title = "Subir um nível";
    up.disabled = pending || !listing || listing.path === "/";

    navigation.append(back, forward, up);

    const breadcrumb = node(documentObject, "nav", "ordax-files-breadcrumb");
    breadcrumb.setAttribute("aria-label", "Caminho atual");
    renderBreadcrumb(breadcrumb);

    const search = node(documentObject, "div", "ordax-files-search");
    const searchInput = node(documentObject, "input", "ordax-files-search-input");
    searchInput.type = "search";
    searchInput.maxLength = 120;
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = "Buscar nesta pasta";
    searchInput.value = searchQuery;
    searchInput.dataset.fileSearch = "";
    searchInput.disabled = pending || !listing;
    searchInput.setAttribute("aria-label", "Buscar pelo nome nesta pasta");
    search.append(searchInput);
    if (searchQuery) {
      const clearSearch = node(documentObject, "button", "ordax-files-search-clear", "Limpar");
      clearSearch.type = "button";
      clearSearch.dataset.fileSearchClear = "";
      clearSearch.disabled = pending;
      search.append(clearSearch);
    }

    const actions = node(documentObject, "div", "ordax-files-actions");
    const refresh = node(documentObject, "button", "ordax-files-action", pending ? "Atualizando…" : "Atualizar");
    refresh.type = "button";
    refresh.dataset.fileRefresh = "";
    refresh.disabled = pending;

    const importFile = node(documentObject, "button", "ordax-files-action", "Importar");
    importFile.type = "button";
    importFile.dataset.fileImportToggle = "";
    importFile.disabled = pending || !listing;

    const importPicker = node(documentObject, "input", "ordax-files-import-picker");
    importPicker.type = "file";
    importPicker.multiple = false;
    importPicker.hidden = true;
    importPicker.dataset.fileImportPicker = "";
    importPicker.setAttribute("aria-label", "Escolher arquivo para importar");

    const addProject = node(documentObject, "button", "ordax-files-action", "Adicionar projeto");
    addProject.type = "button";
    addProject.dataset.fileProjectCreateStart = "";
    addProject.disabled = Boolean(
      pending
      || !projectPort
      || !listing
      || listing.path === "/"
      || projectSnapshot?.projects.some((project) => project.path === listing.path)
    );
    const create = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", "Nova pasta");
    create.type = "button";
    create.dataset.fileCreateToggle = "";
    create.disabled = pending || !listing;
    actions.append(refresh, importFile, addProject);
    const currentProject = projectSnapshot?.projects.find((project) => project.path === listing?.path);
    if (currentProject) {
      if (currentProject.lastFilePath) {
        const resumeProjectButton = node(
          documentObject,
          "button",
          "ordax-files-action ordax-files-action-primary",
          "Continuar último arquivo",
        );
        resumeProjectButton.type = "button";
        resumeProjectButton.dataset.fileProjectResume = currentProject.id;
        resumeProjectButton.disabled = pending || previewPending;
        resumeProjectButton.title = currentProject.lastFilePath;
        actions.append(resumeProjectButton);
        if (
          failedProjectResume?.projectId === currentProject.id
          && failedProjectResume.path === currentProject.lastFilePath
        ) {
          const forgetProjectButton = node(
            documentObject,
            "button",
            "ordax-files-action",
            "Esquecer último arquivo",
          );
          forgetProjectButton.type = "button";
          forgetProjectButton.dataset.fileProjectForgetStale = currentProject.id;
          forgetProjectButton.disabled = pending || previewPending;
          forgetProjectButton.title = "Remove somente a referência de continuidade; o arquivo não é apagado";
          actions.append(forgetProjectButton);
        }
      }
      const renameProjectButton = node(documentObject, "button", "ordax-files-action", "Renomear projeto");
      renameProjectButton.type = "button";
      renameProjectButton.dataset.fileProjectRenameStart = currentProject.id;
      renameProjectButton.disabled = pending;
      const removeProjectButton = node(documentObject, "button", "ordax-files-action", "Remover projeto");
      removeProjectButton.type = "button";
      removeProjectButton.dataset.fileProjectRemove = currentProject.id;
      removeProjectButton.disabled = pending;
      actions.append(renameProjectButton, removeProjectButton);
    }
    actions.append(create, importPicker);
    toolbar.append(navigation, breadcrumb, search, actions);
    content.append(toolbar);

    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      pending
        ? "Atualizando conteúdo…"
        : listing
          ? normalizedSearchQuery()
            ? `${visibleEntries().length} de ${listing.entries.length} itens · busca nesta pasta`
            : `${listing.entries.length} ${listing.entries.length === 1 ? "item" : "itens"}`
          : "Preparando espaço do usuário…",
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);

    renderTransferOperation(content);
    renderCreateDirectory(content);
    renderCreateProject(content);
    renderRenameProject(content);
    if (message) content.append(node(documentObject, "p", "ordax-files-message", message));
    renderEntries(content);
    renderSelectionDetails(content);
    renderTextPreview(content);
    content.append(
      node(
        documentObject,
        "p",
        "ordax-files-boundary",
        "Conteúdo persistente do usuário. O sistema e links simbólicos permanecem fora desta fronteira.",
      ),
    );

    view.append(locations, content);
    slot.append(view);
    restoreInteractionState(slot, interaction);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    const interaction =
      force && slot === mountedSlot ? captureInteractionState(slot) : null;
    mountedSlot = slot;
    paint(slot, interaction);
  };

  const replaceView = () => renderView(true);

  const load = async (path, { recordHistory = true } = {}) => {
    recentMode = false;
    selectedRecentPath = null;
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(await port.list(path));
      if (destroyed || ordinal !== requestOrdinal) return false;
      lifecycle.setAppTarget("files", next.path);
      const changedPath = Boolean(listing && listing.path !== next.path);
      if (changedPath) {
        searchQuery = "";
        selectedPath = null;
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        creatingDirectory = false;
        directoryDraft = "";
        creatingProject = false;
        projectDraft = "";
        renamingProjectId = null;
        projectRenameDraft = "";
        failedProjectResume = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      listing = next;
      if (recordHistory) recordNavigation(next.path);
      if (
        selectedPath &&
        !listing.entries.some((entry) => joinPath(listing.path, entry.name) === selectedPath)
      ) {
        selectedPath = null;
      }
      return true;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return false;
      message = "Não foi possível abrir este local.";
      return false;
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const navigateHistory = async (targetIndex) => {
    if (
      pending ||
      targetIndex < 0 ||
      targetIndex >= navigationHistory.length ||
      targetIndex === navigationIndex
    ) {
      return;
    }
    const targetPath = navigationHistory[targetIndex];
    const previousIndex = navigationIndex;
    const loaded = await load(targetPath, { recordHistory: false });
    if (destroyed) return;
    if (loaded) {
      navigationIndex = targetIndex;
    } else {
      navigationIndex = previousIndex;
    }
    replaceView();
  };

  const openTextFile = async (path, { source = "direct", projectId = null } = {}) => {
    const ordinal = ++previewRequestOrdinal;
    failedProjectResume = null;
    previewPending = true;
    textPreview = null;
    message = null;
    replaceView();
    try {
      const next = validateTextFile(await port.readTextFile(path));
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      textPreview = next;
      if (recentPort) recentPort.recordOpened(next.path);
      const project = projectForFilePath(next.path);
      if (projectPort && project) {
        try {
          projectSnapshot = projectPort.recordFileOpened(project.id, next.path);
        } catch {
          message = "Arquivo aberto, mas a continuidade do projeto não pôde ser atualizada.";
        }
      }
    } catch (error) {
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      const status = operationStatus(error);
      if (source === "project-resume") {
        const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
        if (project?.lastFilePath === path && project.path === listing?.path) {
          failedProjectResume = Object.freeze({ projectId: project.id, path });
        }
        if (status === 404) {
          message = "O último arquivo deste projeto não está mais disponível. O projeto foi preservado.";
        } else if (status === 413) {
          message = "O último arquivo deste projeto ficou grande demais para a visualização rápida. O projeto foi preservado.";
        } else if (status === 415) {
          message = "O último arquivo deste projeto não é mais texto UTF-8 válido. O projeto foi preservado.";
        } else {
          message = "Não foi possível retomar o último arquivo deste projeto. O projeto foi preservado.";
        }
      } else if (status === 413) {
        message = "Este arquivo é grande demais para a visualização rápida (máximo 256 KB).";
      } else if (status === 415) {
        message = "A visualização rápida aceita apenas texto UTF-8 válido.";
      } else {
        message = "Não foi possível visualizar este arquivo.";
      }
    } finally {
      if (!destroyed && ordinal === previewRequestOrdinal) {
        previewPending = false;
        replaceView();
      }
    }
  };

  const activateSelectedPath = () => {
    const selected = selectedEntry();
    if (!selected) return;
    if (selected.kind === "directory") {
      void load(selected.path);
    } else {
      void openTextFile(selected.path);
    }
  };

  const createNoteFromSelected = async () => {
    const selected = selectedEntry();
    if (!notesImporterPort || !selected || selected.kind !== "file" || notesImportPending) return;
    const source = Object.freeze({ kind: "file", path: selected.path, name: selected.name });
    notesImportPending = true;
    message = null;
    replaceView();
    try {
      const outcome = await importSelectedFileToNotes(notesImporterPort, source);
      if (destroyed) return;
      message = outcome.presentation.text;
      if (outcome.presentation.openNotes && activationPort) {
        activationPort.publish({ appId: "notes", target: null });
      }
    } catch {
      if (destroyed) return;
      message = "Não foi possível criar a nota. O arquivo original não foi alterado.";
    } finally {
      if (!destroyed) {
        notesImportPending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const transferToCurrentDirectory = async () => {
    if (!transferEntry || !listing) return;
    const destination = transferDestinationState();
    if (!destination.allowed) {
      message = destination.reason;
      replaceView();
      return;
    }

    const source = transferEntry;
    const destinationPath = listing.path;
    const nextPath = joinPath(destinationPath, source.name);
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const operation =
        source.mode === "copy"
          ? port.copyFile(
              source.sourcePath,
              source.name,
              destinationPath,
              source.name,
            )
          : port.moveEntry(source.sourcePath, source.name, destinationPath);
      const next = validateFileListing(await operation);
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      if (source.mode === "move" && recentPort) {
        recentPort.relocate(source.sourceFullPath, nextPath);
      }
      transferEntry = null;
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      copyingPath = null;
      copyDraft = "";
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      message =
        source.mode === "copy"
          ? `“${source.name}” foi copiado para ${destinationPath}.`
          : `“${source.name}” foi movido para ${destinationPath}.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome no destino. Nada foi substituído.";
      } else if (status === 412) {
        message =
          source.mode === "copy"
            ? "O arquivo mudou durante a cópia. Nenhuma cópia parcial foi mantida."
            : "O arquivo mudou antes da conclusão do movimento. A origem não foi removida.";
      } else if (status === 413) {
        message =
          source.mode === "copy"
            ? "Este arquivo ultrapassa o limite de cópia de 64 MiB."
            : "Mover este arquivo entre volumes ultrapassa o limite seguro de 64 MiB.";
      } else if (status === 422) {
        message = "Pastas ainda não podem ser movidas entre volumes.";
      } else if (status === 507) {
        message = "Não há espaço suficiente no destino.";
      } else if (status === 404) {
        message = "A origem ou o destino não existe mais. Atualize e tente novamente.";
      } else if (status === 403) {
        message =
          source.mode === "copy"
            ? "O OrdaX não tem permissão para copiar este arquivo."
            : "O OrdaX não tem permissão para mover este item.";
      } else if (status === 400) {
        message =
          source.mode === "copy"
            ? "O destino não é válido para esta cópia."
            : "O destino não é válido para este movimento.";
      } else {
        message =
          source.mode === "copy"
            ? "Não foi possível copiar este arquivo. A origem foi preservada."
            : "Não foi possível mover este item. A origem foi preservada.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const importSelectedFile = async (file) => {
    if (!listing || !file) return;
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      message = "O arquivo selecionado tem tamanho inválido.";
      replaceView();
      return;
    }
    if (file.size > MAX_FILE_IMPORT_BYTES) {
      message = "Este arquivo ultrapassa o limite de importação de 64 MiB.";
      replaceView();
      return;
    }
    if (typeof file.name !== "string" || file.name.length === 0 || file.name.length > 255) {
      message = "O nome do arquivo selecionado não é válido.";
      replaceView();
      return;
    }

    const targetPath = listing.path;
    const targetName = file.name;
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const buffer = await file.arrayBuffer();
      if (destroyed || ordinal !== requestOrdinal) return;
      if (buffer.byteLength !== file.size) {
        throw new TypeError("Selected file size changed while reading");
      }
      const next = validateFileListing(
        await port.importFile(targetPath, targetName, new Uint8Array(buffer)),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      selectedPath = joinPath(targetPath, targetName);
      if (!selectionIsVisible()) selectedPath = null;
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      message = `“${targetName}” foi importado para ${targetPath}.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome. Nada foi substituído.";
      } else if (status === 413) {
        message = "Este arquivo ultrapassa o limite de importação de 64 MiB.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para importar nesta pasta.";
      } else if (status === 404) {
        message = "A pasta de destino não existe mais. Atualize e tente novamente.";
      } else if (status === 507) {
        message = "Não há espaço suficiente para importar este arquivo.";
      } else if (status === 400) {
        message = "O arquivo ou o destino não é válido para importação.";
      } else {
        message = "Não foi possível importar este arquivo. Nenhum arquivo parcial foi mantido.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const exportSelected = async () => {
    const selected = selectedEntry();
    if (!selected || selected.kind !== "file") return;
    if (selected.size > MAX_FILE_EXPORT_BYTES) {
      message = "Este arquivo ultrapassa o limite de exportação de 64 MiB.";
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      await port.exportFile(selected.path);
      if (destroyed || ordinal !== requestOrdinal) return;
      message = `Download de “${selected.name}” iniciado.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 413) {
        message = "Este arquivo ultrapassa o limite de exportação de 64 MiB.";
      } else if (status === 412) {
        message = "O arquivo mudou durante a exportação. Tente novamente.";
      } else if (status === 404) {
        message = "Este arquivo não existe mais. Atualize a pasta.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para exportar este arquivo.";
      } else if (status === 400) {
        message = "Este item não pode ser exportado.";
      } else {
        message = "Não foi possível exportar este arquivo.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const copySelected = async () => {
    const selected = selectedEntry();
    if (!selected || !listing || selected.kind !== "file") return;

    if (selected.size > MAX_FILE_COPY_BYTES) {
      message = "Este arquivo ultrapassa o limite de cópia de 64 MiB.";
      copyingPath = null;
      copyDraft = "";
      replaceView();
      return;
    }

    const newName = String(copyDraft ?? "");
    if (!newName) {
      message = "Digite o nome da cópia.";
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    const nextPath = joinPath(listing.path, newName);
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(
        await port.copyFile(listing.path, selected.name, listing.path, newName),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      copyingPath = null;
      copyDraft = "";
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      message = `Cópia “${newName}” criada.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome. Nada foi substituído.";
      } else if (status === 412) {
        message = "O arquivo mudou durante a cópia. Nenhuma cópia parcial foi mantida.";
      } else if (status === 413) {
        message = "Este arquivo ultrapassa o limite de cópia de 64 MiB.";
      } else if (status === 507) {
        message = "Não há espaço suficiente para criar a cópia.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para copiar este arquivo.";
      } else if (status === 404) {
        message = "O arquivo de origem não existe mais.";
      } else if (status === 400) {
        message = "O nome da cópia não é válido.";
      } else {
        message = "Não foi possível copiar este arquivo.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const renameSelected = async () => {
    const selected = selectedEntry();
    if (!selected || !listing) return;

    const newName = String(renameDraft ?? "");
    if (!newName) {
      message = "Digite o novo nome.";
      replaceView();
      return;
    }
    if (newName === selected.name) {
      renamingPath = null;
      renameDraft = "";
      message = "O nome não foi alterado.";
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    const previousPath = selected.path;
    const nextPath = joinPath(listing.path, newName);
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(
        await port.renameEntry(listing.path, selected.name, newName),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      if (recentPort) recentPort.relocate(previousPath, nextPath);
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      if (textPreview?.path === previousPath) {
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      message = `“${selected.name}” foi renomeado para “${newName}”.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome. Nada foi substituído.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para renomear este item.";
      } else if (status === 404) {
        message = "Este item não existe mais. Atualize a pasta.";
      } else if (status === 400) {
        message = "O novo nome não é válido.";
      } else {
        message = "Não foi possível renomear este item.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const createDirectory = async (name) => {
    const trimmed = String(name ?? "").trim();
    if (!listing || !trimmed) {
      message = "Digite um nome para a nova pasta.";
      replaceView();
      return;
    }
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(await port.createDirectory(listing.path, trimmed));
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      creatingDirectory = false;
      directoryDraft = "";
      message = `Pasta “${trimmed}” criada.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome. Nada foi substituído.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para criar uma pasta aqui.";
      } else if (status === 507) {
        message = "Não há espaço suficiente para criar a pasta.";
      } else if (status === 400) {
        message = "O nome da pasta não é válido.";
      } else {
        message = "Não foi possível criar a pasta.";
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const onClick = (event) => {
    const projectLocation = event.target.closest("[data-file-open-project]");
    if (projectLocation && root.contains(projectLocation) && projectPort) {
      void openProject(projectLocation.dataset.fileOpenProject);
      return;
    }
    const projectStart = event.target.closest("[data-file-project-create-start]");
    if (projectStart && root.contains(projectStart) && projectPort && listing && listing.path !== "/") {
      creatingProject = true;
      projectDraft = breadcrumbParts(listing.path).at(-1) ?? "Projeto";
      renamingProjectId = null;
      projectRenameDraft = "";
      message = null;
      requestFocus("project-name");
      replaceView();
      return;
    }
    const projectCreate = event.target.closest("[data-file-project-create]");
    if (projectCreate && root.contains(projectCreate)) {
      createProject();
      return;
    }
    const projectCancel = event.target.closest("[data-file-project-create-cancel]");
    if (projectCancel && root.contains(projectCancel)) {
      creatingProject = false;
      projectDraft = "";
      message = null;
      replaceView();
      return;
    }
    const projectResume = event.target.closest("[data-file-project-resume]");
    if (projectResume && root.contains(projectResume) && projectPort && listing && !previewPending) {
      const projectId = projectResume.dataset.fileProjectResume;
      const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
      if (project?.lastFilePath && project.path === listing.path) {
        void openTextFile(project.lastFilePath, { source: "project-resume", projectId: project.id });
      }
      return;
    }
    const projectForgetStale = event.target.closest("[data-file-project-forget-stale]");
    if (projectForgetStale && root.contains(projectForgetStale) && projectPort && !previewPending) {
      clearFailedProjectResume(projectForgetStale.dataset.fileProjectForgetStale);
      return;
    }
    const projectRenameStart = event.target.closest("[data-file-project-rename-start]");
    if (projectRenameStart && root.contains(projectRenameStart) && projectPort && listing) {
      const projectId = projectRenameStart.dataset.fileProjectRenameStart;
      const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
      if (project && project.path === listing.path) {
        creatingProject = false;
        projectDraft = "";
        renamingProjectId = project.id;
        projectRenameDraft = project.name;
        message = null;
        requestFocus("project-rename-name", project.id);
        replaceView();
      }
      return;
    }
    const projectRenameConfirm = event.target.closest("[data-file-project-rename-confirm]");
    if (projectRenameConfirm && root.contains(projectRenameConfirm)) {
      renameProject();
      return;
    }
    const projectRenameCancel = event.target.closest("[data-file-project-rename-cancel]");
    if (projectRenameCancel && root.contains(projectRenameCancel)) {
      renamingProjectId = null;
      projectRenameDraft = "";
      message = null;
      replaceView();
      return;
    }
    const projectRemove = event.target.closest("[data-file-project-remove]");
    if (projectRemove && root.contains(projectRemove) && projectPort) {
      removeProject(projectRemove.dataset.fileProjectRemove);
      return;
    }
    const recentLocation = event.target.closest("[data-file-open-recent]");
    if (recentLocation && root.contains(recentLocation) && recentPort) {
      enterRecentMode();
      return;
    }
    const recentRow = event.target.closest("[data-file-recent-path]");
    if (recentRow && root.contains(recentRow) && recentMode) {
      const path = recentRow.dataset.fileRecentPath;
      if (selectedRecentPath === path) {
        if (!previewPending) void openTextFile(path);
      } else {
        selectedRecentPath = path;
        message = null;
        if (textPreview?.path !== path) {
          previewRequestOrdinal += 1;
          previewPending = false;
          textPreview = null;
        }
        replaceView();
      }
      return;
    }
    const recentOpen = event.target.closest("[data-file-recent-open]");
    if (recentOpen && root.contains(recentOpen)) {
      const selected = selectedRecentEntry();
      if (selected && !previewPending) void openTextFile(selected.path);
      return;
    }
    const recentReveal = event.target.closest("[data-file-recent-reveal]");
    if (recentReveal && root.contains(recentReveal)) {
      void revealRecent();
      return;
    }
    const recentRemove = event.target.closest("[data-file-recent-remove]");
    if (recentRemove && root.contains(recentRemove) && recentPort) {
      const selected = selectedRecentEntry();
      if (selected) {
        message = `“${selected.name}” foi removido de Recentes. O arquivo não foi apagado.`;
        selectedRecentPath = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
        recentPort.remove(selected.path);
        replaceView();
      }
      return;
    }
    const recentClear = event.target.closest("[data-file-recent-clear]");
    if (recentClear && root.contains(recentClear) && recentPort) {
      message = "Histórico limpo. Nenhum arquivo foi apagado.";
      selectedRecentPath = null;
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      recentPort.clear();
      replaceView();
      return;
    }
    const recentSearchClear = event.target.closest("[data-file-recent-search-clear]");
    if (recentSearchClear && root.contains(recentSearchClear)) {
      recentSearchQuery = "";
      message = null;
      requestFocus("recent-search");
      replaceView();
      return;
    }
    const sort = event.target.closest("[data-file-sort-key]");
    if (sort && root.contains(sort) && !pending) {
      changeSort(sort.dataset.fileSortKey);
      return;
    }
    const selected = event.target.closest("[data-file-select-path]");
    if (selected && root.contains(selected)) {
      if (selectedPath === selected.dataset.fileSelectPath) {
        activateSelectedPath();
      } else {
        selectPath(selected.dataset.fileSelectPath, { focus: true });
      }
      return;
    }
    const createNote = event.target.closest("[data-file-create-note]");
    if (createNote && root.contains(createNote)) {
      void createNoteFromSelected();
      return;
    }
    const exportFile = event.target.closest("[data-file-export]");
    if (exportFile && root.contains(exportFile)) {
      void exportSelected();
      return;
    }
    const copyToToggle = event.target.closest("[data-file-copy-to-toggle]");
    if (copyToToggle && root.contains(copyToToggle)) {
      const selected = selectedEntry();
      if (selected?.kind === "file" && listing) {
        if (selected.size > MAX_FILE_COPY_BYTES) {
          message = "Este arquivo ultrapassa o limite de cópia de 64 MiB.";
        } else {
          transferEntry = Object.freeze({
            mode: "copy",
            sourcePath: listing.path,
            sourceFullPath: selected.path,
            name: selected.name,
            kind: selected.kind,
          });
          renamingPath = null;
          renameDraft = "";
          copyingPath = null;
          copyDraft = "";
          previewRequestOrdinal += 1;
          previewPending = false;
          textPreview = null;
          message = "Navegue até a pasta de destino e escolha “Copiar para esta pasta”.";
        }
        replaceView();
      }
      return;
    }
    const moveToggle = event.target.closest("[data-file-move-toggle]");
    if (moveToggle && root.contains(moveToggle)) {
      const selected = selectedEntry();
      if (selected && listing) {
        transferEntry = Object.freeze({
          mode: "move",
          sourcePath: listing.path,
          sourceFullPath: selected.path,
          name: selected.name,
          kind: selected.kind,
        });
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
        message = "Navegue até a pasta de destino e escolha “Mover para esta pasta”.";
        replaceView();
      }
      return;
    }
    const transferCancel = event.target.closest("[data-file-transfer-cancel]");
    if (transferCancel && root.contains(transferCancel)) {
      const wasCopy = transferEntry?.mode === "copy";
      transferEntry = null;
      message = wasCopy
        ? "Cópia cancelada. Nenhum item foi alterado."
        : "Movimento cancelado. Nenhum item foi alterado.";
      replaceView();
      return;
    }
    const transferConfirm = event.target.closest("[data-file-transfer-confirm]");
    if (transferConfirm && root.contains(transferConfirm)) {
      void transferToCurrentDirectory();
      return;
    }
    const copyToggle = event.target.closest("[data-file-copy-toggle]");
    if (copyToggle && root.contains(copyToggle)) {
      const selected = selectedEntry();
      if (selected?.kind === "file") {
        if (selected.size > MAX_FILE_COPY_BYTES) {
          message = "Este arquivo ultrapassa o limite de cópia de 64 MiB.";
          replaceView();
        } else {
          copyingPath = selected.path;
          copyDraft = suggestedCopyName(selected.name);
          renamingPath = null;
          renameDraft = "";
          message = null;
          requestFocus("copy-name", selected.path);
          replaceView();
        }
      }
      return;
    }
    const copyCancel = event.target.closest("[data-file-copy-cancel]");
    if (copyCancel && root.contains(copyCancel)) {
      copyingPath = null;
      copyDraft = "";
      message = null;
      replaceView();
      return;
    }
    const copyConfirm = event.target.closest("[data-file-copy-confirm]");
    if (copyConfirm && root.contains(copyConfirm)) {
      void copySelected();
      return;
    }
    const renameToggle = event.target.closest("[data-file-rename-toggle]");
    if (renameToggle && root.contains(renameToggle)) {
      const selected = selectedEntry();
      if (selected) {
        renamingPath = selected.path;
        renameDraft = selected.name;
        copyingPath = null;
        copyDraft = "";
        message = null;
        requestFocus("rename-name", selected.path);
        replaceView();
      }
      return;
    }
    const renameCancel = event.target.closest("[data-file-rename-cancel]");
    if (renameCancel && root.contains(renameCancel)) {
      renamingPath = null;
      renameDraft = "";
      message = null;
      replaceView();
      return;
    }
    const renameConfirm = event.target.closest("[data-file-rename-confirm]");
    if (renameConfirm && root.contains(renameConfirm)) {
      void renameSelected();
      return;
    }
    const activate = event.target.closest("[data-file-activate-selected]");
    if (activate && root.contains(activate)) {
      activateSelectedPath();
      return;
    }
    const previewClose = event.target.closest("[data-file-preview-close]");
    if (previewClose && root.contains(previewClose)) {
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      message = null;
      replaceView();
      return;
    }
    const back = event.target.closest("[data-file-history-back]");
    if (back && root.contains(back) && canGoBack() && !pending) {
      void navigateHistory(navigationIndex - 1);
      return;
    }
    const forward = event.target.closest("[data-file-history-forward]");
    if (forward && root.contains(forward) && canGoForward() && !pending) {
      void navigateHistory(navigationIndex + 1);
      return;
    }
    const up = event.target.closest("[data-file-history-up]");
    if (up && root.contains(up) && listing && listing.path !== "/" && !pending) {
      void load(parentPath(listing.path));
      return;
    }
    const open = event.target.closest("[data-file-open-path]");
    if (open && root.contains(open)) {
      void load(open.dataset.fileOpenPath);
      return;
    }
    const clearSearch = event.target.closest("[data-file-search-clear]");
    if (clearSearch && root.contains(clearSearch)) {
      searchQuery = "";
      message = null;
      requestFocus("search");
      replaceView();
      return;
    }
    const importToggle = event.target.closest("[data-file-import-toggle]");
    if (importToggle && root.contains(importToggle) && !pending && listing) {
      findSlot()?.querySelector("[data-file-import-picker]")?.click();
      return;
    }
    const refresh = event.target.closest("[data-file-refresh]");
    if (refresh && listing) {
      void load(listing.path, { recordHistory: false });
      return;
    }
    const createToggle = event.target.closest("[data-file-create-toggle]");
    if (createToggle) {
      creatingDirectory = true;
      directoryDraft = "";
      message = null;
      requestFocus("directory-name");
      replaceView();
      return;
    }
    const cancel = event.target.closest("[data-file-create-cancel]");
    if (cancel) {
      creatingDirectory = false;
      directoryDraft = "";
      message = null;
      replaceView();
      return;
    }
    const create = event.target.closest("[data-file-create-directory]");
    if (create) {
      void createDirectory(directoryDraft);
    }
  };

  const onChange = (event) => {
    if (!event.target.matches?.("[data-file-import-picker]")) return;
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) void importSelectedFile(file);
  };

  const onInput = (event) => {
    if (event.target.matches?.("[data-file-recent-search]")) {
      recentSearchQuery = String(event.target.value ?? "").slice(0, 120);
      if (
        selectedRecentPath
        && !visibleRecentEntries().some((entry) => entry.path === selectedRecentPath)
      ) {
        selectedRecentPath = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      message = null;
      replaceView();
    } else if (event.target.matches?.("[data-file-search]")) {
      searchQuery = String(event.target.value ?? "").slice(0, 120);
      if (!selectionIsVisible()) {
        selectedPath = null;
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      message = null;
      replaceView();
    } else if (event.target.matches?.("[data-file-project-rename-name]")) {
      projectRenameDraft = String(event.target.value ?? "").slice(0, MAX_PROJECT_NAME_LENGTH);
    } else if (event.target.matches?.("[data-file-project-name]")) {
      projectDraft = String(event.target.value ?? "").slice(0, MAX_PROJECT_NAME_LENGTH);
    } else if (event.target.matches?.("[data-file-directory-name]")) {
      directoryDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-rename-name]")) {
      renameDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-copy-name]")) {
      copyDraft = event.target.value;
    }
  };

  const onKeyDown = (event) => {
    if (event.target.matches?.("[data-file-recent-search]")) {
      if (event.key === "Escape" && recentSearchQuery) {
        event.preventDefault();
        recentSearchQuery = "";
        message = null;
        requestFocus("recent-search");
        replaceView();
      }
      return;
    }

    const recentRow = event.target.closest?.("[data-file-recent-path]");
    if (recentRow && root.contains(recentRow)) {
      const slot = findSlot();
      const rows = slot ? [...slot.querySelectorAll("[data-file-recent-path]")] : [];
      const index = rows.indexOf(recentRow);
      if (index < 0) return;
      if (event.key === "Enter") {
        event.preventDefault();
        selectedRecentPath = recentRow.dataset.fileRecentPath;
        void openTextFile(selectedRecentPath);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        selectedRecentPath = recentRow.dataset.fileRecentPath;
        message = null;
        replaceView();
        return;
      }
      let nextIndex = null;
      if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, index + 1);
      if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = rows.length - 1;
      if (nextIndex === null || nextIndex === index) return;
      event.preventDefault();
      selectedRecentPath = rows[nextIndex].dataset.fileRecentPath;
      message = null;
      replaceView();
      return;
    }

    if (event.target.matches?.("[data-file-search]")) {
      if (event.key === "Escape" && searchQuery) {
        event.preventDefault();
        searchQuery = "";
        message = null;
        requestFocus("search");
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-copy-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void copySelected();
      } else if (event.key === "Escape" && !pending) {
        copyingPath = null;
        copyDraft = "";
        message = null;
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-rename-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void renameSelected();
      } else if (event.key === "Escape" && !pending) {
        renamingPath = null;
        renameDraft = "";
        message = null;
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-project-rename-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        renameProject();
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingProjectId = null;
        projectRenameDraft = "";
        message = null;
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-project-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        createProject();
      } else if (event.key === "Escape") {
        event.preventDefault();
        creatingProject = false;
        projectDraft = "";
        message = null;
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-directory-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void createDirectory(directoryDraft);
      } else if (event.key === "Escape" && !pending) {
        creatingDirectory = false;
        directoryDraft = "";
        message = null;
        replaceView();
      }
      return;
    }

    const row = event.target.closest?.("[data-file-select-path]");
    if (!row || !root.contains(row)) return;

    const rows = [...findSlot().querySelectorAll("[data-file-select-path]")];
    const index = rows.indexOf(row);
    if (index < 0) return;

    if (event.key === "Enter") {
      event.preventDefault();
      selectPath(row.dataset.fileSelectPath);
      const selected = listing?.entries.find(
        (entry) => joinPath(listing.path, entry.name) === row.dataset.fileSelectPath,
      );
      if (!selected) return;
      if (selected.kind === "directory") {
        void load(row.dataset.fileSelectPath);
      } else {
        void openTextFile(row.dataset.fileSelectPath);
      }
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      selectPath(row.dataset.fileSelectPath, { focus: true });
      return;
    }

    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = rows.length - 1;
    if (nextIndex === null || nextIndex === index) return;

    event.preventDefault();
    selectPath(rows[nextIndex].dataset.fileSelectPath, { focus: true });
  };

  const loadWithFallback = async (target, fallback = "/") => {
    const loaded = await load(target);
    if (destroyed || loaded) return loaded;
    if (listing) {
      lifecycle.setAppTarget("files", listing.path);
      return false;
    }
    if (target !== fallback) {
      const fallbackLoaded = await load(fallback);
      if (destroyed || fallbackLoaded) return fallbackLoaded;
    }
    lifecycle.setAppTarget("files", null);
    return false;
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeRecent = recentPort?.subscribe((snapshot) => {
    if (destroyed) return;
    recentSnapshot = validateRecentFilesSnapshot(snapshot);
    if (
      selectedRecentPath
      && !recentSnapshot.entries.some((entry) => entry.path === selectedRecentPath)
    ) {
      selectedRecentPath = null;
    }
    if (recentMode) replaceView();
  });
  const unsubscribeProjects = projectPort?.subscribe((snapshot) => {
    if (destroyed) return;
    projectSnapshot = validateProjectCatalogSnapshot(snapshot);
    if (
      renamingProjectId
      && !projectSnapshot.projects.some((project) => project.id === renamingProjectId)
    ) {
      renamingProjectId = null;
      projectRenameDraft = "";
    }
    if (failedProjectResume) {
      const project = projectSnapshot.projects.find(
        (candidate) => candidate.id === failedProjectResume.projectId,
      );
      if (!project || project.lastFilePath !== failedProjectResume.path) {
        failedProjectResume = null;
      }
    }
    replaceView();
  });
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (activation.appId === "files" && activation.target) {
      void loadWithFallback(activation.target);
    }
  });
  const initialTarget = lifecycle.getAppTarget("files") ?? "/";
  void loadWithFallback(initialTarget);

  return Object.freeze({
    destroy() {
      destroyed = true;
      requestOrdinal += 1;
      previewRequestOrdinal += 1;
      unsubscribeActivation?.();
      unsubscribeRecent?.();
      unsubscribeProjects?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      const slot = findSlot();
      if (slot?.dataset.ordaxFileSpaceView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxFileSpaceView;
        delete slot.dataset.fileSpacePath;
        delete slot.dataset.fileSpaceContext;
      }
      mountedSlot = null;
    },
  });
}
