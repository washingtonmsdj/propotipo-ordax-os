import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  MAX_FILE_COPY_BYTES,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../contracts/file-space.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

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
) {
  if (!(root instanceof Element)) {
    throw new TypeError("File-space controls require a Surface root Element");
  }
  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  if (!port) {
    return Object.freeze({ destroy() {} });
  }
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
  let movingEntry = null;
  let searchQuery = "";
  let sortKey = "name";
  let sortDirection = "asc";
  let navigationHistory = [];
  let navigationIndex = -1;

  const findSlot = () =>
    root.querySelector(`${FILE_WINDOW_SELECTOR} ${FILE_EXTENSION_SELECTOR}`);

  const renderLocations = (container) => {
    const heading = node(documentObject, "p", "ordax-files-section-label", "Locais");
    container.append(heading);
    for (const location of LOCATIONS) {
      const button = node(documentObject, "button", "ordax-files-location", location.label);
      button.type = "button";
      button.dataset.fileOpenPath = location.path;
      const active = Boolean(listing && locationIsActive(listing.path, location.path));
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      container.append(button);
    }
  };

  const parentPath = (path) => {
    if (typeof path !== "string" || path === "/") return "/";
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    return parts.length === 0 ? "/" : `/${parts.join("/")}`;
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
    queueMicrotask(() => input.isConnected && input.focus());
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
      } else {
        compared = compareEntryNames(left, right);
      }
      if (compared === 0) compared = compareEntryNames(left, right);
      return compared * direction;
    });
    return filtered;
  };

  const changeSort = (key) => {
    if (!["name", "type", "size"].includes(key)) return;
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

  const moveDestinationState = () => {
    if (!movingEntry || !listing) {
      return Object.freeze({ allowed: false, reason: "Escolha uma pasta de destino." });
    }
    if (listing.path === movingEntry.sourcePath) {
      return Object.freeze({
        allowed: false,
        reason: "O item já está nesta pasta. Escolha outra pasta.",
      });
    }
    if (
      movingEntry.kind === "directory" &&
      (listing.path === movingEntry.sourceFullPath ||
        listing.path.startsWith(`${movingEntry.sourceFullPath}/`))
    ) {
      return Object.freeze({
        allowed: false,
        reason: "Uma pasta não pode ser movida para dentro dela mesma.",
      });
    }
    return Object.freeze({ allowed: true, reason: "" });
  };

  const renderMoveOperation = (container) => {
    if (!movingEntry) return;
    const destination = moveDestinationState();
    const panel = node(documentObject, "section", "ordax-files-move");
    panel.setAttribute("aria-label", "Mover item");

    const copy = node(documentObject, "div", "ordax-files-move-copy");
    copy.append(
      node(documentObject, "strong", "ordax-files-move-title", `Movendo “${movingEntry.name}”`),
      node(
        documentObject,
        "span",
        "ordax-files-move-meta",
        listing ? `Destino atual: ${listing.path}` : "Abrindo destino…",
      ),
      node(
        documentObject,
        "span",
        "ordax-files-move-guidance",
        destination.allowed
          ? "Confirme para mover sem substituir itens existentes."
          : destination.reason,
      ),
    );

    const actions = node(documentObject, "div", "ordax-files-move-actions");
    const confirm = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      "Mover para esta pasta",
    );
    confirm.type = "button";
    confirm.dataset.fileMoveConfirm = "";
    confirm.disabled = pending || !destination.allowed;

    const cancel = node(documentObject, "button", "ordax-files-action", "Cancelar");
    cancel.type = "button";
    cancel.dataset.fileMoveCancel = "";
    cancel.disabled = pending;

    actions.append(confirm, cancel);
    panel.append(copy, actions);
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
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderSelectionDetails = (container) => {
    if (movingEntry) return;
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
    );

    const actions = node(documentObject, "div", "ordax-files-details-actions");
    let copy = null;
    if (selected.kind === "file") {
      copy = node(documentObject, "button", "ordax-files-action", "Copiar");
      copy.type = "button";
      copy.dataset.fileCopyToggle = "";
      copy.disabled = pending || previewPending;
    }
    const move = node(documentObject, "button", "ordax-files-action", "Mover");
    move.type = "button";
    move.dataset.fileMoveToggle = "";
    move.disabled = pending || previewPending;
    const rename = node(documentObject, "button", "ordax-files-action", "Renomear");
    rename.type = "button";
    rename.dataset.fileRenameToggle = "";
    rename.disabled = pending || previewPending;
    const open = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      selected.kind === "directory" ? "Abrir pasta" : "Visualizar texto",
    );
    open.type = "button";
    open.dataset.fileActivateSelected = "";
    open.disabled = pending || previewPending;
    if (copy) actions.append(copy);
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
      queueMicrotask(() => input.isConnected && input.focus());
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
      queueMicrotask(() => input.isConnected && input.focus());
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

  const paint = (slot) => {
    slot.replaceChildren();
    slot.dataset.ordaxFileSpaceView = "";

    const view = node(documentObject, "div", "ordax-files-view");
    const locations = node(documentObject, "nav", "ordax-files-locations");
    locations.setAttribute("aria-label", "Locais de arquivos");
    renderLocations(locations);

    const content = node(documentObject, "section", "ordax-files-content");
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
    const create = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", "Nova pasta");
    create.type = "button";
    create.dataset.fileCreateToggle = "";
    create.disabled = pending || !listing;
    actions.append(refresh, create);
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

    renderMoveOperation(content);
    renderCreateDirectory(content);
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
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    mountedSlot = slot;
    paint(slot);
  };

  const replaceView = () => renderView(true);

  const load = async (path, { recordHistory = true } = {}) => {
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(await port.list(path));
      if (destroyed || ordinal !== requestOrdinal) return false;
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

  const openTextFile = async (path) => {
    const ordinal = ++previewRequestOrdinal;
    previewPending = true;
    textPreview = null;
    message = null;
    replaceView();
    try {
      const next = validateTextFile(await port.readTextFile(path));
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      textPreview = next;
    } catch (error) {
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      const status = operationStatus(error);
      if (status === 413) {
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

  const moveToCurrentDirectory = async () => {
    if (!movingEntry || !listing) return;
    const destination = moveDestinationState();
    if (!destination.allowed) {
      message = destination.reason;
      replaceView();
      return;
    }

    const source = movingEntry;
    const destinationPath = listing.path;
    const nextPath = joinPath(destinationPath, source.name);
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replaceView();
    try {
      const next = validateFileListing(
        await port.moveEntry(source.sourcePath, source.name, destinationPath),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      movingEntry = null;
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      copyingPath = null;
      copyDraft = "";
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      message = `“${source.name}” foi movido para ${destinationPath}.`;
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        message = "Já existe um item com esse nome no destino. Nada foi substituído.";
      } else if (status === 422) {
        message = "Este destino exige mover entre volumes. Essa operação segura ainda não está disponível.";
      } else if (status === 404) {
        message = "A origem ou o destino não existe mais. Atualize e tente novamente.";
      } else if (status === 403) {
        message = "O OrdaX não tem permissão para mover este item.";
      } else if (status === 400) {
        message = "O destino não é válido para este movimento.";
      } else {
        message = "Não foi possível mover este item. A origem foi preservada.";
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
        await port.copyFile(listing.path, selected.name, newName),
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
    const moveToggle = event.target.closest("[data-file-move-toggle]");
    if (moveToggle && root.contains(moveToggle)) {
      const selected = selectedEntry();
      if (selected && listing) {
        movingEntry = Object.freeze({
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
    const moveCancel = event.target.closest("[data-file-move-cancel]");
    if (moveCancel && root.contains(moveCancel)) {
      movingEntry = null;
      message = "Movimento cancelado. Nenhum item foi alterado.";
      replaceView();
      return;
    }
    const moveConfirm = event.target.closest("[data-file-move-confirm]");
    if (moveConfirm && root.contains(moveConfirm)) {
      void moveToCurrentDirectory();
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
      replaceView();
      queueMicrotask(() => findSlot()?.querySelector("[data-file-search]")?.focus());
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

  const onInput = (event) => {
    if (event.target.matches?.("[data-file-search]")) {
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
      const caret = searchQuery.length;
      replaceView();
      queueMicrotask(() => {
        if (destroyed) return;
        const input = findSlot()?.querySelector("[data-file-search]");
        if (!input) return;
        input.focus();
        input.setSelectionRange?.(caret, caret);
      });
    } else if (event.target.matches?.("[data-file-directory-name]")) {
      directoryDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-rename-name]")) {
      renameDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-copy-name]")) {
      copyDraft = event.target.value;
    }
  };

  const onKeyDown = (event) => {
    if (event.target.matches?.("[data-file-search]")) {
      if (event.key === "Escape" && searchQuery) {
        event.preventDefault();
        searchQuery = "";
        message = null;
        replaceView();
        queueMicrotask(() => findSlot()?.querySelector("[data-file-search]")?.focus());
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

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (activation.appId === "files" && activation.target) {
      void load(activation.target);
    }
  });
  void load("/");

  return Object.freeze({
    destroy() {
      destroyed = true;
      requestOrdinal += 1;
      previewRequestOrdinal += 1;
      unsubscribeActivation?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      const slot = findSlot();
      if (slot?.dataset.ordaxFileSpaceView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxFileSpaceView;
      }
      mountedSlot = null;
    },
  });
}
