import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  assertFileSpacePort,
  validateFileSpacePath,
  validateImagePreview,
} from "../../contracts/file-space.mjs";
import {
  NOTES_HOME_PROJECT_ID,
  assertNotesRuntime,
} from "../../services/notes/runtime.mjs";
import {
  applyNotesRichLink,
  captureNotesRichSelection,
  createNotesRichEditor,
  handleNotesRichBlockKeyDown,
  normalizeNotesRichEditor,
  notesRichSelectionState,
  pastePlainTextIntoNotesEditor,
  preventNotesRichDrop,
  readNotesRichBody,
  renderNotesRichBody,
  restoreNotesRichSelection,
  setNotesRichBlockType,
  toggleNotesRichInlineMark,
  undoNotesRichEditor,
} from "./notes-rich-editor.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const NOTES_WINDOW_SELECTOR = '[data-window-id="notes"]';
const NOTES_EXTENSION_SELECTOR = '[data-app-extension="notes-workspace"]';
const SAVE_DELAY_MS = 320;
const WEB_PROTOCOLS = Object.freeze(["http:", "https:"]);
const IMAGE_FILE_RE = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;
const EDITOR_FORMAT_ACTIONS = new Set(["bold", "italic", "insert-link", "undo"]);

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(documentObject, className, label, action, text = label) {
  const element = node(documentObject, "button", className, text);
  element.type = "button";
  element.dataset.notesAction = action;
  element.setAttribute("aria-label", label);
  element.title = label;
  return element;
}

function formatRelativeTime(timestamp, now = Date.now()) {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60000) return "Agora";
  if (delta < 86400000) {
    const hours = Math.max(1, Math.floor(delta / 3600000));
    return `${hours} h`;
  }
  if (delta < 2 * 86400000) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(timestamp));
}

function hostFromHref(href) {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

function joinLogicalPath(path, name) {
  const base = validateFileSpacePath(path);
  return validateFileSpacePath(base === "/" ? `/${name}` : `${base}/${name}`);
}

function parentLogicalPath(path) {
  const valid = validateFileSpacePath(path);
  if (valid === "/") return "/";
  const parts = valid.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function firstBodyLine(body) {
  return body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Nota sem conteúdo";
}

function noteMatchesQuery(note, query) {
  if (!query) return true;
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
  return haystack.includes(query.toLocaleLowerCase("pt-BR"));
}

function visibleNotes(documentState, mode, query, newestFirst = true) {
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

function buildShell(documentObject) {
  const view = node(documentObject, "div", "ordax-notes-view");
  view.dataset.ordaxNotesView = "";

  const nav = node(documentObject, "aside", "ordax-notes-nav");
  const searchLabel = node(documentObject, "label", "ordax-notes-search");
  searchLabel.setAttribute("aria-label", "Buscar notas");
  searchLabel.append(node(documentObject, "span", "ordax-notes-search-icon", "⌕"));
  const search = node(documentObject, "input", "ordax-notes-search-input");
  search.type = "search";
  search.placeholder = "Buscar notas";
  search.autocomplete = "off";
  search.dataset.notesSearch = "";
  searchLabel.append(search);
  nav.append(searchLabel);

  const newNote = button(documentObject, "ordax-notes-new", "Nova nota", "new-note", "＋  Nova nota");
  nav.append(newNote);

  const navList = node(documentObject, "div", "ordax-notes-nav-list");
  navList.append(
    button(documentObject, "ordax-notes-nav-item", "Todas as notas", "view-all", "▱  Todas as notas"),
    button(documentObject, "ordax-notes-nav-item", "Favoritas", "view-favorites", "☆  Favoritas"),
    button(documentObject, "ordax-notes-nav-item", "Recentes", "view-recent", "◷  Recentes"),
    button(documentObject, "ordax-notes-nav-item", "Lixeira", "view-trash", "♲  Lixeira"),
  );
  nav.append(navList);

  const projectsHeader = node(documentObject, "div", "ordax-notes-projects-header");
  projectsHeader.append(node(documentObject, "span", "", "PROJETOS"));
  projectsHeader.append(button(documentObject, "ordax-notes-project-add", "Novo projeto", "new-project", "＋"));
  nav.append(projectsHeader);
  nav.append(node(documentObject, "div", "ordax-notes-projects"));
  const device = node(documentObject, "div", "ordax-notes-device", "▱  Neste dispositivo");
  device.dataset.notesDevice = "";
  nav.append(device);

  const list = node(documentObject, "section", "ordax-notes-list-pane");
  const listHeader = node(documentObject, "header", "ordax-notes-list-header");
  const listHeading = node(documentObject, "div");
  listHeading.append(
    node(documentObject, "strong", "ordax-notes-list-title", "Meu espaço"),
    node(documentObject, "small", "ordax-notes-list-count", "0 notas"),
  );
  const listActions = node(documentObject, "div", "ordax-notes-list-actions");
  const emptyTrash = button(
    documentObject,
    "ordax-notes-empty-trash",
    "Esvaziar lixeira",
    "empty-trash",
    "Esvaziar",
  );
  emptyTrash.hidden = true;
  const sort = button(documentObject, "ordax-notes-sort", "Ordenar por atualização", "sort", "≡");
  listActions.append(emptyTrash, sort);
  listHeader.append(listHeading, listActions);
  list.append(listHeader, node(documentObject, "div", "ordax-notes-list"));

  const editor = node(documentObject, "main", "ordax-notes-editor-pane");
  const top = node(documentObject, "header", "ordax-notes-editor-top");
  const breadcrumb = node(documentObject, "div", "ordax-notes-breadcrumb", "Meu espaço  /  Notas");
  const topActions = node(documentObject, "div", "ordax-notes-top-actions");
  topActions.append(
    node(documentObject, "span", "ordax-notes-save-status", "Salvo neste dispositivo"),
    button(documentObject, "ordax-notes-star", "Adicionar aos favoritos", "favorite", "☆"),
    button(documentObject, "ordax-notes-refs-toggle", "Mostrar referências", "toggle-references", "Referências"),
    button(documentObject, "ordax-notes-more", "Mais ações", "toggle-menu", "•••"),
  );
  const menu = node(documentObject, "div", "ordax-notes-menu");
  menu.hidden = true;
  const trashAction = button(
    documentObject,
    "ordax-notes-menu-item ordax-notes-trash-action",
    "Mover nota para lixeira",
    "trash-note",
    "Mover para a lixeira",
  );
  const permanentDeleteAction = button(
    documentObject,
    "ordax-notes-menu-item ordax-notes-delete-forever",
    "Excluir nota permanentemente",
    "delete-note-forever",
    "Excluir permanentemente",
  );
  permanentDeleteAction.hidden = true;
  const moveSection = node(documentObject, "section", "ordax-notes-move-section");
  moveSection.append(
    node(documentObject, "span", "ordax-notes-menu-label", "MOVER PARA"),
    node(documentObject, "div", "ordax-notes-move-projects"),
  );
  menu.append(trashAction, permanentDeleteAction, moveSection);
  top.append(breadcrumb, topActions, menu);
  editor.append(top);

  const toolbar = node(documentObject, "div", "ordax-notes-toolbar");
  const format = node(documentObject, "select", "ordax-notes-format");
  format.dataset.notesFormat = "";
  for (const [value, label] of [["text", "Texto"], ["h2", "Título 2"], ["list", "Lista"], ["quote", "Citação"]]) {
    const option = node(documentObject, "option", "", label);
    option.value = value;
    format.append(option);
  }
  toolbar.append(
    format,
    button(documentObject, "ordax-notes-tool", "Negrito (Ctrl/Cmd+B)", "bold", "B"),
    button(documentObject, "ordax-notes-tool ordax-notes-tool-italic", "Itálico (Ctrl/Cmd+I)", "italic", "I"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", "Adicionar item de checklist", "add-task", "☑"),
    button(documentObject, "ordax-notes-tool", "Inserir link no texto (Ctrl/Cmd+K)", "insert-link", "↗"),
    button(documentObject, "ordax-notes-tool", "Relacionar imagem local", "insert-image", "▧"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", "Desfazer (Ctrl/Cmd+Z)", "undo", "↶"),
  );
  editor.append(toolbar);

  const paper = node(documentObject, "article", "ordax-notes-paper");
  const empty = node(documentObject, "div", "ordax-notes-empty");
  empty.append(
    node(documentObject, "strong", "", "Nenhuma nota selecionada"),
    node(documentObject, "p", "", "Crie uma nova nota ou escolha uma nota existente."),
  );
  empty.dataset.notesEmpty = "";
  const form = node(documentObject, "div", "ordax-notes-document");
  form.dataset.notesDocument = "";
  form.hidden = true;
  form.append(
    node(documentObject, "span", "ordax-notes-kicker", "NOTA"),
  );
  const title = node(documentObject, "textarea", "ordax-notes-title");
  title.rows = 1;
  title.maxLength = 1024;
  title.spellcheck = true;
  title.placeholder = "Título da nota";
  title.dataset.notesTitle = "";
  title.setAttribute("aria-label", "Título da nota");
  form.append(title);
  form.append(node(documentObject, "div", "ordax-notes-meta"));
  const body = createNotesRichEditor(documentObject);
  form.append(body);
  const inlineMedia = node(documentObject, "section", "ordax-notes-inline-media");
  inlineMedia.dataset.notesInlineMedia = "";
  inlineMedia.hidden = true;
  form.append(inlineMedia);
  const tasksSection = node(documentObject, "section", "ordax-notes-tasks");
  tasksSection.append(node(documentObject, "h3", "", "Para hoje"), node(documentObject, "div", "ordax-notes-task-list"));
  form.append(tasksSection);
  paper.append(empty, form);
  editor.append(paper);
  const editorFooter = node(documentObject, "footer", "ordax-notes-editor-footer");
  editorFooter.append(node(documentObject, "span", "ordax-notes-offline-status", "Disponível offline"));
  editor.append(editorFooter);

  const refs = node(documentObject, "aside", "ordax-notes-references");
  refs.dataset.notesReferences = "";
  const refsHeader = node(documentObject, "header", "ordax-notes-refs-header");
  refsHeader.append(
    node(documentObject, "strong", "", "Referências"),
    button(documentObject, "ordax-notes-refs-close", "Recolher referências", "toggle-references", "×"),
  );
  refs.append(refsHeader, node(documentObject, "div", "ordax-notes-refs-content"));
  const addRef = button(documentObject, "ordax-notes-add-reference", "Adicionar referência", "add-reference", "＋  Adicionar referência");
  const refChoices = node(documentObject, "div", "ordax-notes-reference-choices");
  refChoices.dataset.notesReferenceChoices = "";
  refChoices.hidden = true;
  refChoices.append(
    button(documentObject, "ordax-notes-reference-choice", "Adicionar link da web", "add-link-reference", "◎  Link da web"),
    button(documentObject, "ordax-notes-reference-choice", "Relacionar arquivo deste dispositivo", "add-file-reference", "▱  Arquivo deste dispositivo"),
  );
  const filePicker = node(documentObject, "section", "ordax-notes-file-picker");
  filePicker.dataset.notesFilePicker = "";
  filePicker.hidden = true;
  refs.append(
    addRef,
    refChoices,
    filePicker,
    node(documentObject, "p", "ordax-notes-refs-caption", "Fontes próximas das suas ideias."),
  );

  view.append(nav, list, editor, refs);
  return view;
}

export function mountNotesWorkspaceControls(
  root,
  notesRuntime,
  surfaceLifecycle = null,
  { fileSpace = null, appActivation = null } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Notes workspace controls require a Surface root Element");
  }
  const runtime = assertNotesRuntime(notesRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const filePort = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView ?? globalThis.window;

  let state = runtime.getSnapshot();
  let mode = "project";
  let query = "";
  let referencesOpen = true;
  let newestFirst = true;
  let projectMenuId = null;
  let referenceChooserOpen = false;
  let referenceNoteId = null;
  let filePickerOpen = false;
  let filePickerPath = "/";
  let filePickerListing = null;
  let filePickerPending = false;
  let filePickerError = "";
  let filePickerPurpose = "file";
  let selectedFilePath = null;
  let filePickerOrdinal = 0;
  let lastEditorRange = null;
  let mountedSlot = null;
  let saveTimer = null;
  let pendingNoteId = null;
  const imagePreviews = new Map();
  let imagePreviewOrdinal = 0;
  let destroyed = false;

  const currentNote = () => {
    const id = state.document.selectedNoteId;
    return state.document.notes.find((note) => note.id === id) ?? null;
  };

  const persistEditor = (noteId) => {
    if (!mountedSlot || !noteId) return false;
    const title = mountedSlot.querySelector("[data-notes-title]");
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return false;
    normalizeNotesRichEditor(body);
    try {
      const richBody = readNotesRichBody(body);
      runtime.updateNote(noteId, {
        title: title?.value ?? "",
        richBody,
      });
      return true;
    } catch {
      const status = mountedSlot.querySelector(".ordax-notes-save-status");
      if (status) status.textContent = "Não foi possível salvar esta edição";
      return false;
    }
  };

  const flushEditor = () => {
    if (!mountedSlot || pendingNoteId === null) return;
    if (saveTimer !== null) {
      windowObject.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const noteId = pendingNoteId;
    pendingNoteId = null;
    persistEditor(noteId);
  };

  const scheduleSave = () => {
    const note = currentNote();
    if (!note || !mountedSlot) return;
    pendingNoteId = note.id;
    const status = mountedSlot.querySelector(".ordax-notes-save-status");
    if (status) status.textContent = "Salvando…";
    if (saveTimer !== null) windowObject.clearTimeout(saveTimer);
    saveTimer = windowObject.setTimeout(() => {
      saveTimer = null;
      const noteId = pendingNoteId;
      pendingNoteId = null;
      if (!noteId || !mountedSlot) return;
      persistEditor(noteId);
    }, SAVE_DELAY_MS);
  };

  const resetReferenceFlow = () => {
    referenceChooserOpen = false;
    referenceNoteId = null;
    filePickerOpen = false;
    filePickerListing = null;
    filePickerPending = false;
    filePickerError = "";
    filePickerPurpose = "file";
    selectedFilePath = null;
    filePickerOrdinal += 1;
  };

  const imageReferenceKey = (noteId, reference) => `${noteId}:${reference.id}`;

  const isImageReference = (reference) => (
    reference?.kind === "file"
    && reference.detail === "Imagem local"
    && IMAGE_FILE_RE.test(reference.path ?? reference.title ?? "")
  );

  const revokeImagePreview = (entry) => {
    if (!entry?.url) return;
    windowObject.URL?.revokeObjectURL?.(entry.url);
  };

  const releaseImagePreviewsExcept = (activeKeys = new Set()) => {
    for (const [key, entry] of imagePreviews) {
      if (activeKeys.has(key)) continue;
      revokeImagePreview(entry);
      imagePreviews.delete(key);
    }
  };

  const releaseAllImagePreviews = () => {
    for (const entry of imagePreviews.values()) revokeImagePreview(entry);
    imagePreviews.clear();
    imagePreviewOrdinal += 1;
  };

  const loadImagePreview = async (noteId, reference) => {
    if (
      destroyed
      || !filePort
      || typeof filePort.readImagePreview !== "function"
      || !reference?.path
    ) {
      return;
    }
    const key = imageReferenceKey(noteId, reference);
    const requestId = ++imagePreviewOrdinal;
    imagePreviews.set(key, {
      path: reference.path,
      status: "loading",
      requestId,
      url: "",
      mime: "",
    });
    try {
      const preview = validateImagePreview(await filePort.readImagePreview(reference.path));
      const current = imagePreviews.get(key);
      if (destroyed || !current || current.requestId !== requestId || current.path !== reference.path) {
        return;
      }

      const createObjectURL = windowObject.URL?.createObjectURL?.bind(windowObject.URL);
      const BlobCtor = windowObject.Blob;
      if (typeof createObjectURL !== "function" || typeof BlobCtor !== "function") {
        throw new TypeError("Image preview requires browser object URLs");
      }
      const url = createObjectURL(new BlobCtor([preview.bytes], { type: preview.mime }));
      const activeNote = currentNote();
      const stillRelated = activeNote?.id === noteId
        && activeNote.references.some((candidate) => (
          candidate.id === reference.id
          && candidate.path === reference.path
          && isImageReference(candidate)
        ));
      if (!stillRelated || destroyed) {
        windowObject.URL?.revokeObjectURL?.(url);
        return;
      }

      imagePreviews.set(key, {
        path: reference.path,
        status: "ready",
        requestId,
        url,
        mime: preview.mime,
      });
    } catch {
      const current = imagePreviews.get(key);
      if (!destroyed && current?.requestId === requestId) {
        imagePreviews.set(key, {
          path: reference.path,
          status: "failed",
          requestId,
          url: "",
          mime: "",
        });
      }
    }
    if (!destroyed) render();
  };

  const loadFilePicker = async (path) => {
    if (!filePort) return;
    const target = validateFileSpacePath(path);
    const ordinal = ++filePickerOrdinal;
    filePickerPending = true;
    filePickerError = "";
    selectedFilePath = null;
    render();
    try {
      const listing = await filePort.list(target);
      if (ordinal !== filePickerOrdinal) return;
      filePickerListing = listing;
      filePickerPath = listing.path;
    } catch {
      if (ordinal !== filePickerOrdinal) return;
      filePickerListing = null;
      filePickerError = "Não foi possível abrir esta pasta.";
    } finally {
      if (ordinal === filePickerOrdinal) {
        filePickerPending = false;
        render();
      }
    }
  };

  const renderProjects = (view) => {
    const projects = view.querySelector(".ordax-notes-projects");
    projects.replaceChildren();
    for (const project of state.document.projects) {
      const row = node(documentObject, "div", "ordax-notes-project-row");
      row.dataset.projectId = project.id;
      row.dataset.active = String(mode === "project" && project.id === state.document.selectedProjectId);

      const projectButton = button(
        documentObject,
        "ordax-notes-project",
        `Abrir projeto ${project.name}`,
        "select-project",
        "",
      );
      projectButton.dataset.projectId = project.id;
      projectButton.dataset.active = row.dataset.active;
      projectButton.append(
        node(documentObject, "span", "ordax-notes-project-icon", "□"),
        node(documentObject, "span", "ordax-notes-project-name", project.name),
      );

      const actions = button(
        documentObject,
        "ordax-notes-project-actions",
        `Ações do projeto ${project.name}`,
        "project-actions",
        "•••",
      );
      actions.dataset.projectId = project.id;
      actions.setAttribute("aria-expanded", String(projectMenuId === project.id));
      row.append(projectButton, actions);
      projects.append(row);

      if (projectMenuId === project.id) {
        const projectMenu = node(documentObject, "div", "ordax-notes-project-menu");
        if (project.id !== NOTES_HOME_PROJECT_ID) {
          const rename = button(
            documentObject,
            "ordax-notes-project-menu-item",
            `Renomear projeto ${project.name}`,
            "rename-project",
            "Renomear",
          );
          rename.dataset.projectId = project.id;
          projectMenu.append(rename);
          const remove = button(
            documentObject,
            "ordax-notes-project-menu-item ordax-notes-project-menu-danger",
            `Excluir projeto ${project.name}`,
            "remove-project",
            "Excluir projeto",
          );
          remove.dataset.projectId = project.id;
          projectMenu.append(remove);
        } else {
          projectMenu.append(
            node(
              documentObject,
              "small",
              "ordax-notes-project-menu-hint",
              "Meu espaço é o projeto base e não pode ser renomeado nem excluído.",
            ),
          );
        }
        projects.append(projectMenu);
      }
    }
  };

  const modeLabel = () => {
    if (mode === "all") return "Todas as notas";
    if (mode === "favorites") return "Favoritas";
    if (mode === "recent") return "Recentes";
    if (mode === "trash") return "Lixeira";
    return state.document.projects.find((project) => project.id === state.document.selectedProjectId)?.name ?? "Meu espaço";
  };

  const renderList = (view) => {
    const items = visibleNotes(state.document, mode, query, newestFirst);
    view.querySelector(".ordax-notes-list-title").textContent = modeLabel();
    view.querySelector(".ordax-notes-list-count").textContent = `${items.length} ${items.length === 1 ? "nota" : "notas"}`;
    const emptyTrash = view.querySelector(".ordax-notes-empty-trash");
    emptyTrash.hidden = mode !== "trash";
    emptyTrash.disabled = mode !== "trash" || items.length === 0;
    const list = view.querySelector(".ordax-notes-list");
    list.replaceChildren();
    for (const note of items) {
      const row = button(documentObject, "ordax-notes-row", `Abrir ${note.title || "nota sem título"}`, "select-note", "");
      row.dataset.noteId = note.id;
      row.dataset.active = String(note.id === state.document.selectedNoteId);
      const icon = node(documentObject, "span", "ordax-notes-row-icon", note.favorite ? "★" : "▤");
      const copy = node(documentObject, "span", "ordax-notes-row-copy");
      copy.append(
        node(documentObject, "strong", "", note.title || "Sem título"),
        node(documentObject, "small", "", firstBodyLine(note.body)),
      );
      const time = node(documentObject, "time", "ordax-notes-row-time", formatRelativeTime(note.updatedAt));
      row.append(icon, copy, time);
      list.append(row);
    }
    if (items.length === 0) {
      list.append(node(documentObject, "p", "ordax-notes-list-empty", query ? "Nenhuma nota corresponde à busca." : "Nenhuma nota aqui ainda."));
    }

    for (const action of ["all", "favorites", "recent", "trash"]) {
      const actionButton = view.querySelector(`[data-notes-action="view-${action}"]`);
      if (actionButton) actionButton.dataset.active = String(mode === action);
    }
  };

  const renderInlineMedia = (view, note) => {
    const media = view.querySelector("[data-notes-inline-media]");
    const references = note.references.filter(isImageReference);
    const activeKeys = new Set(references.map((reference) => imageReferenceKey(note.id, reference)));
    releaseImagePreviewsExcept(activeKeys);
    media.replaceChildren();
    media.hidden = references.length === 0;
    if (references.length === 0) return;

    for (const reference of references) {
      const key = imageReferenceKey(note.id, reference);
      let preview = imagePreviews.get(key);
      if (preview && preview.path !== reference.path) {
        revokeImagePreview(preview);
        imagePreviews.delete(key);
        preview = null;
      }

      const figure = node(documentObject, "figure", "ordax-notes-inline-image");
      figure.dataset.referenceId = reference.id;
      const frame = node(documentObject, "div", "ordax-notes-inline-image-frame");

      if (preview?.status === "ready" && preview.url) {
        const image = node(documentObject, "img", "ordax-notes-inline-image-preview");
        image.src = preview.url;
        image.alt = reference.title || "Imagem relacionada à nota";
        image.loading = "lazy";
        image.decoding = "async";
        image.draggable = false;
        frame.append(image);
      } else {
        const message = !filePort || typeof filePort.readImagePreview !== "function"
          ? "Prévia disponível no OrdaX Native."
          : preview?.status === "failed"
            ? "Não foi possível carregar a prévia. O arquivo continua relacionado."
            : "Carregando imagem…";
        frame.append(node(documentObject, "span", "ordax-notes-inline-image-placeholder", message));
        if (!preview && filePort && typeof filePort.readImagePreview === "function") {
          void loadImagePreview(note.id, reference);
        }
      }

      const caption = node(documentObject, "figcaption", "ordax-notes-inline-image-caption");
      const copy = node(documentObject, "span", "ordax-notes-inline-image-copy");
      copy.append(
        node(documentObject, "strong", "", reference.title || "Imagem"),
        node(documentObject, "small", "", reference.path || "Arquivo local"),
      );
      const actions = node(documentObject, "span", "ordax-notes-inline-image-actions");
      if (activationPort && reference.path) {
        const open = button(
          documentObject,
          "ordax-notes-inline-image-action",
          "Abrir localização da imagem no Arquivos",
          "open-file-reference",
          "Abrir no Arquivos",
        );
        open.dataset.filePath = reference.path;
        actions.append(open);
      }
      const remove = button(
        documentObject,
        "ordax-notes-inline-image-action ordax-notes-inline-image-remove",
        "Remover imagem da nota",
        "remove-reference",
        "Remover",
      );
      remove.dataset.referenceId = reference.id;
      actions.append(remove);
      caption.append(copy, actions);
      figure.append(frame, caption);
      media.append(figure);
    }
  };

  const renderTasks = (view, note) => {
    const taskList = view.querySelector(".ordax-notes-task-list");
    taskList.replaceChildren();
    const section = view.querySelector(".ordax-notes-tasks");
    section.hidden = note.tasks.length === 0;
    for (const task of note.tasks) {
      const row = node(documentObject, "div", "ordax-notes-task");
      row.dataset.done = String(task.done);
      const checkbox = node(documentObject, "input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.dataset.taskId = task.id;
      checkbox.dataset.notesTaskDone = "";
      checkbox.setAttribute("aria-label", `Marcar “${task.text}” como concluído`);
      const text = node(documentObject, "input", "ordax-notes-task-text");
      text.type = "text";
      text.value = task.text;
      text.maxLength = 2048;
      text.dataset.taskId = task.id;
      text.dataset.notesTaskText = "";
      text.setAttribute("aria-label", "Texto do item");
      const remove = button(
        documentObject,
        "ordax-notes-task-remove",
        `Remover item ${task.text}`,
        "remove-task",
        "×",
      );
      remove.dataset.taskId = task.id;
      row.append(checkbox, text, remove);
      taskList.append(row);
    }
  };

  const renderReferenceControls = (view, note) => {
    if (referenceNoteId !== null && referenceNoteId !== note.id) {
      resetReferenceFlow();
    }
    const choices = view.querySelector("[data-notes-reference-choices]");
    choices.hidden = !referenceChooserOpen;
    const fileChoice = choices.querySelector('[data-notes-action="add-file-reference"]');
    fileChoice.disabled = filePort === null;
    fileChoice.title = filePort
      ? "Relacionar um arquivo local à nota"
      : "Arquivos locais estão disponíveis no OrdaX Native";

    const picker = view.querySelector("[data-notes-file-picker]");
    picker.hidden = !filePickerOpen;
    picker.replaceChildren();
    if (!filePickerOpen) return;

    const header = node(documentObject, "header", "ordax-notes-file-picker-header");
    const heading = node(documentObject, "div", "ordax-notes-file-picker-heading");
    heading.append(
      node(
        documentObject,
        "strong",
        "",
        filePickerPurpose === "image" ? "Relacionar imagem" : "Relacionar arquivo",
      ),
      node(documentObject, "small", "", filePickerPath),
    );
    header.append(
      heading,
      button(documentObject, "ordax-notes-file-picker-close", "Fechar seletor de arquivos", "close-file-picker", "×"),
    );
    picker.append(header);

    const navigation = node(documentObject, "div", "ordax-notes-file-picker-nav");
    const up = button(documentObject, "ordax-notes-file-picker-up", "Subir uma pasta", "file-picker-up", "↑  Pasta acima");
    up.disabled = filePickerPath === "/" || filePickerPending;
    navigation.append(up);
    picker.append(navigation);

    const list = node(documentObject, "div", "ordax-notes-file-picker-list");
    if (filePickerPending) {
      list.append(node(documentObject, "p", "ordax-notes-file-picker-message", "Carregando arquivos…"));
    } else if (filePickerError) {
      list.append(node(documentObject, "p", "ordax-notes-file-picker-message", filePickerError));
    } else if (filePickerListing) {
      const entries = [...filePickerListing.entries]
        .filter((entry) => (
          filePickerPurpose !== "image"
          || entry.kind === "directory"
          || IMAGE_FILE_RE.test(entry.name)
        ))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
        });
      if (entries.length === 0) {
        list.append(node(documentObject, "p", "ordax-notes-file-picker-message", "Esta pasta está vazia."));
      }
      for (const entry of entries) {
        const fullPath = joinLogicalPath(filePickerListing.path, entry.name);
        const action = entry.kind === "directory" ? "file-picker-open-directory" : "file-picker-select-file";
        const row = button(
          documentObject,
          "ordax-notes-file-picker-row",
          entry.kind === "directory" ? `Abrir pasta ${entry.name}` : `Selecionar arquivo ${entry.name}`,
          action,
          "",
        );
        row.dataset.filePath = fullPath;
        row.dataset.kind = entry.kind;
        row.dataset.selected = String(entry.kind === "file" && selectedFilePath === fullPath);
        row.append(
          node(documentObject, "span", "ordax-notes-file-picker-icon", entry.kind === "directory" ? "□" : "▱"),
          node(documentObject, "span", "ordax-notes-file-picker-name", entry.name),
          node(documentObject, "small", "ordax-notes-file-picker-kind", entry.kind === "directory" ? "Pasta" : "Arquivo"),
        );
        list.append(row);
      }
    }
    picker.append(list);

    const attach = button(
      documentObject,
      "ordax-notes-file-picker-attach",
      filePickerPurpose === "image" ? "Relacionar imagem selecionada" : "Relacionar arquivo selecionado",
      "attach-file-reference",
      filePickerPurpose === "image" ? "Relacionar imagem" : "Relacionar arquivo",
    );
    attach.disabled = !selectedFilePath || filePickerPending;
    picker.append(attach);
  };

  const renderReferences = (view, note) => {
    const panel = view.querySelector("[data-notes-references]");
    panel.hidden = !referencesOpen;
    const refs = view.querySelector(".ordax-notes-refs-content");
    refs.replaceChildren();
    refs.append(node(documentObject, "span", "ordax-notes-refs-kicker", "DESTA NOTA"));

    const links = note.references.filter((reference) => reference.kind === "link");
    const files = note.references.filter((reference) => reference.kind === "file");
    if (note.references.length === 0) {
      refs.append(node(documentObject, "p", "ordax-notes-refs-empty", "Nenhuma referência adicionada."));
    }

    for (const reference of links) {
      const card = node(documentObject, "article", "ordax-notes-ref-card");
      const leading = node(documentObject, "span", "ordax-notes-ref-icon", "◎");
      const copy = node(documentObject, "span", "ordax-notes-ref-copy");
      copy.append(
        node(documentObject, "strong", "", reference.title),
        node(documentObject, "small", "", hostFromHref(reference.href)),
        node(documentObject, "span", "", reference.detail || "Link"),
      );
      const remove = button(documentObject, "ordax-notes-ref-remove", "Remover referência", "remove-reference", "×");
      remove.dataset.referenceId = reference.id;
      card.append(leading, copy, remove);
      if (reference.href) {
        card.dataset.href = reference.href;
        card.tabIndex = 0;
        card.setAttribute("role", "link");
      }
      refs.append(card);
    }

    if (files.length) {
      refs.append(node(documentObject, "h3", "ordax-notes-refs-subtitle", "Arquivos relacionados"));
      for (const reference of files) {
        const card = node(documentObject, "article", "ordax-notes-ref-card ordax-notes-file-ref-card");
        const copy = node(documentObject, "span", "ordax-notes-ref-copy");
        copy.append(
          node(documentObject, "strong", "", reference.title),
          node(documentObject, "small", "", reference.path || "Arquivo local"),
          node(documentObject, "span", "", reference.detail || "Arquivo local"),
        );
        if (reference.path && activationPort) {
          const open = button(documentObject, "ordax-notes-ref-open", "Abrir localização no Arquivos", "open-file-reference", "Abrir");
          open.dataset.filePath = reference.path;
          copy.append(open);
        }
        const remove = button(documentObject, "ordax-notes-ref-remove", "Remover referência", "remove-reference", "×");
        remove.dataset.referenceId = reference.id;
        card.append(node(documentObject, "span", "ordax-notes-ref-icon", "▱"), copy, remove);
        refs.append(card);
      }
    }

    renderReferenceControls(view, note);
  };

  const syncEditorToolbar = () => {
    if (!mountedSlot) return;
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return;
    const selection = notesRichSelectionState(body);
    const format = mountedSlot.querySelector("[data-notes-format]");
    const formatValue = {
      paragraph: "text",
      heading: "h2",
      bullet: "list",
      quote: "quote",
    }[selection.blockType] ?? "text";
    if (format) format.value = formatValue;
    const bold = mountedSlot.querySelector('[data-notes-action="bold"]');
    const italic = mountedSlot.querySelector('[data-notes-action="italic"]');
    if (bold) {
      bold.dataset.active = String(selection.bold);
      bold.setAttribute("aria-pressed", String(selection.bold));
    }
    if (italic) {
      italic.dataset.active = String(selection.italic);
      italic.setAttribute("aria-pressed", String(selection.italic));
    }
  };

  const restoreEditorRange = () => {
    if (!mountedSlot || !lastEditorRange) return false;
    const body = mountedSlot.querySelector("[data-notes-body]");
    return body ? restoreNotesRichSelection(body, lastEditorRange) : false;
  };

  const focusEditorBody = () => {
    if (!mountedSlot) return false;
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return false;
    body.focus();
    if (lastEditorRange && restoreNotesRichSelection(body, lastEditorRange)) {
      syncEditorToolbar();
      return true;
    }

    const target = body.querySelector("[data-notes-rich-block]") ?? body;
    const selection = documentObject.getSelection?.();
    if (!selection) return false;
    const range = documentObject.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    lastEditorRange = range.cloneRange();
    syncEditorToolbar();
    return true;
  };

  const renderMoveProjects = (view, note) => {
    const list = view.querySelector(".ordax-notes-move-projects");
    list.replaceChildren();
    const targets = state.document.projects.filter((project) => project.id !== note.projectId);
    const section = view.querySelector(".ordax-notes-move-section");
    section.hidden = targets.length === 0 || note.deletedAt !== null;
    for (const project of targets) {
      const move = button(
        documentObject,
        "ordax-notes-menu-item ordax-notes-move-project",
        `Mover nota para ${project.name}`,
        "move-note-project",
        project.name,
      );
      move.dataset.projectId = project.id;
      list.append(move);
    }
  };

  const renderEditor = (view) => {
    const note = currentNote();
    const empty = view.querySelector("[data-notes-empty]");
    const documentView = view.querySelector("[data-notes-document]");
    const controls = view.querySelectorAll(".ordax-notes-toolbar button, .ordax-notes-format, .ordax-notes-star, .ordax-notes-more");
    for (const control of controls) control.disabled = !note;
    const imageTool = view.querySelector('[data-notes-action="insert-image"]');
    if (imageTool) imageTool.disabled = !note || filePort === null;

    if (!note) {
      releaseImagePreviewsExcept(new Set());
      empty.hidden = false;
      documentView.hidden = true;
      view.querySelector(".ordax-notes-breadcrumb").textContent = `${modeLabel()}  /  Notas`;
      view.querySelector(".ordax-notes-save-status").textContent = state.persistence.scope === "device" ? "Salvo neste dispositivo" : "Somente nesta sessão";
      view.querySelector(".ordax-notes-references").hidden = true;
      return;
    }

    empty.hidden = true;
    documentView.hidden = false;
    const project = state.document.projects.find((candidate) => candidate.id === note.projectId);
    view.querySelector(".ordax-notes-breadcrumb").textContent = `${project?.name ?? "Meu espaço"}  /  Notas`;
    const active = documentObject.activeElement;
    const title = view.querySelector("[data-notes-title]");
    const body = view.querySelector("[data-notes-body]");
    if (view.dataset.renderedNoteId !== note.id) {
      title.value = note.title;
      renderNotesRichBody(body, note.richBody);
      view.dataset.renderedNoteId = note.id;
      lastEditorRange = null;
    } else {
      if (active !== title && pendingNoteId !== note.id) title.value = note.title;
      if (active !== body && pendingNoteId !== note.id) renderNotesRichBody(body, note.richBody);
    }
    title.style.height = "auto";
    title.style.height = `${Math.min(150, Math.max(58, title.scrollHeight))}px`;

    const meta = view.querySelector(".ordax-notes-meta");
    meta.textContent = `${project?.name ?? "Meu espaço"}  ·  Nota local`;
    const star = view.querySelector(".ordax-notes-star");
    star.textContent = note.favorite ? "★" : "☆";
    star.setAttribute("aria-label", note.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos");
    const menuAction = view.querySelector(".ordax-notes-trash-action");
    const permanentDeleteAction = view.querySelector(".ordax-notes-delete-forever");
    menuAction.textContent = note.deletedAt === null ? "Mover para a lixeira" : "Restaurar nota";
    menuAction.dataset.notesAction = note.deletedAt === null ? "trash-note" : "restore-note";
    permanentDeleteAction.hidden = note.deletedAt === null;
    renderMoveProjects(view, note);
    renderInlineMedia(view, note);
    renderTasks(view, note);
    renderReferences(view, note);

    const saved = view.querySelector(".ordax-notes-save-status");
    saved.textContent = state.persistence.ok
      ? (state.persistence.scope === "device" ? "✓  Salvo neste dispositivo" : "✓  Salvo nesta sessão")
      : "Falha ao salvar localmente";
    view.querySelector(".ordax-notes-offline-status").textContent =
      state.persistence.scope === "device" ? "☁  Disponível offline" : "Somente nesta sessão";
    view.querySelector(".ordax-notes-device").textContent =
      state.persistence.scope === "device" ? "▱  Neste dispositivo" : "▱  Sessão temporária";
  };

  const render = () => {
    const windowNode = root.querySelector(NOTES_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(NOTES_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      releaseAllImagePreviews();
      mountedSlot = null;
      return;
    }
    if (!slot.dataset.ordaxNotesMounted) {
      slot.replaceChildren(buildShell(documentObject));
      slot.dataset.ordaxNotesMounted = "true";
    }
    mountedSlot = slot;
    const view = slot.querySelector("[data-ordax-notes-view]");
    renderProjects(view);
    renderList(view);
    renderEditor(view);
  };

  const selectFirstVisible = () => {
    const first = visibleNotes(state.document, mode, query, newestFirst)[0];
    if (first) runtime.selectNote(first.id);
  };

  const promptEditorLink = (body) => {
    const href = windowObject.prompt?.("Cole o endereço do link:");
    if (!href) return false;
    let valid = false;
    try {
      valid = WEB_PROTOCOLS.includes(new URL(href).protocol);
    } catch {
      valid = false;
    }
    if (!valid) {
      windowObject.alert?.("Use um endereço da web válido.");
      return false;
    }
    if (!applyNotesRichLink(body, href)) {
      windowObject.alert?.("Selecione um trecho da nota antes de adicionar o link.");
      return false;
    }
    return true;
  };

  const onClick = (event) => {
    const editorLink = event.target.closest?.("[data-notes-body] a");
    if (editorLink && mountedSlot?.contains(editorLink)) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        windowObject.open?.(editorLink.href, "_blank", "noopener,noreferrer");
      }
      return;
    }
    const actionNode = event.target.closest("[data-notes-action]");
    if (!actionNode || !mountedSlot?.contains(actionNode)) return;
    const action = actionNode.dataset.notesAction;
    const note = currentNote();

    if (action === "new-note") {
      resetReferenceFlow();
      flushEditor();
      mode = "project";
      runtime.createNote(state.document.selectedProjectId);
      queueMicrotask(() => mountedSlot?.querySelector("[data-notes-title]")?.select());
      return;
    }
    if (action === "new-project") {
      const name = windowObject.prompt?.("Nome do novo projeto:");
      if (name?.trim()) {
        projectMenuId = null;
        flushEditor();
        mode = "project";
        runtime.createProject(name);
      }
      return;
    }
    if (action === "project-actions") {
      const projectId = actionNode.dataset.projectId;
      projectMenuId = projectMenuId === projectId ? null : projectId;
      renderProjects(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (action === "rename-project") {
      const projectId = actionNode.dataset.projectId;
      const project = state.document.projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const name = windowObject.prompt?.("Novo nome do projeto:", project.name);
      if (name?.trim()) {
        projectMenuId = null;
        runtime.renameProject(projectId, name);
      }
      return;
    }
    if (action === "remove-project") {
      const projectId = actionNode.dataset.projectId;
      const project = state.document.projects.find((candidate) => candidate.id === projectId);
      if (!project || project.id === NOTES_HOME_PROJECT_ID) return;
      const noteCount = state.document.notes.filter((candidate) => candidate.projectId === projectId).length;
      const confirmed = windowObject.confirm?.(
        noteCount > 0
          ? `Excluir “${project.name}”? As ${noteCount} ${noteCount === 1 ? "nota será movida" : "notas serão movidas"} para Meu espaço.`
          : `Excluir o projeto “${project.name}”?`,
      );
      if (confirmed) {
        projectMenuId = null;
        flushEditor();
        mode = "project";
        runtime.removeProject(projectId);
      }
      return;
    }
    if (action === "select-project") {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      mode = "project";
      runtime.selectProject(actionNode.dataset.projectId);
      return;
    }
    if (action === "select-note") {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      runtime.selectNote(actionNode.dataset.noteId);
      return;
    }
    if (["view-all", "view-favorites", "view-recent", "view-trash"].includes(action)) {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      mode = action.replace("view-", "");
      render();
      const selected = currentNote();
      const visible = visibleNotes(state.document, mode, query, newestFirst);
      if (!selected || !visible.some((item) => item.id === selected.id)) selectFirstVisible();
      return;
    }
    if (action === "sort") {
      newestFirst = !newestFirst;
      actionNode.textContent = newestFirst ? "≡" : "≣";
      actionNode.title = newestFirst ? "Mais recentes primeiro" : "Mais antigas primeiro";
      renderList(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (action === "empty-trash") {
      const deletedCount = state.document.notes.filter((candidate) => candidate.deletedAt !== null).length;
      if (deletedCount === 0) return;
      const confirmed = windowObject.confirm?.(
        deletedCount === 1
          ? "Excluir permanentemente a nota da lixeira? Esta ação não pode ser desfeita."
          : `Excluir permanentemente as ${deletedCount} notas da lixeira? Esta ação não pode ser desfeita.`,
      );
      if (confirmed) {
        resetReferenceFlow();
        flushEditor();
        runtime.emptyTrash();
      }
      return;
    }
    if (!note) return;

    const body = mountedSlot.querySelector("[data-notes-body]");
    if (action === "favorite") runtime.toggleFavorite(note.id);
    if (action === "add-task") runtime.addTask(note.id);
    if (action === "remove-task") runtime.removeTask(note.id, actionNode.dataset.taskId);
    if (action === "move-note-project") {
      const projectId = actionNode.dataset.projectId;
      const target = state.document.projects.find((project) => project.id === projectId);
      if (target && target.id !== note.projectId) {
        flushEditor();
        mode = "project";
        runtime.moveNote(note.id, target.id);
        const menu = mountedSlot?.querySelector(".ordax-notes-menu");
        if (menu) menu.hidden = true;
      }
    }
    if (action === "trash-note") runtime.trashNote(note.id);
    if (action === "restore-note") {
      const projectId = note.projectId;
      runtime.restoreNote(note.id);
      if (mode === "trash") {
        const next = visibleNotes(state.document, "trash", query, newestFirst)[0];
        if (next) {
          runtime.selectNote(next.id);
        } else {
          mode = "project";
          runtime.selectProject(projectId);
        }
      }
    }
    if (action === "delete-note-forever" && note.deletedAt !== null) {
      const confirmed = windowObject.confirm?.(
        `Excluir “${note.title || "Sem título"}” permanentemente? Esta ação não pode ser desfeita.`,
      );
      if (confirmed) {
        resetReferenceFlow();
        runtime.permanentlyDeleteNote(note.id);
        if (mode === "trash") selectFirstVisible();
      }
    }
    if (action === "toggle-references") {
      referencesOpen = !referencesOpen;
      render();
    }
    if (action === "toggle-menu") {
      const menu = mountedSlot.querySelector(".ordax-notes-menu");
      menu.hidden = !menu.hidden;
    }
    if (action === "bold") {
      restoreEditorRange();
      toggleNotesRichInlineMark(body, "bold");
      syncEditorToolbar();
    }
    if (action === "italic") {
      restoreEditorRange();
      toggleNotesRichInlineMark(body, "italic");
      syncEditorToolbar();
    }
    if (action === "insert-link") {
      restoreEditorRange();
      promptEditorLink(body);
      syncEditorToolbar();
    }
    if (action === "insert-image" && filePort) {
      referencesOpen = true;
      referenceNoteId = note.id;
      referenceChooserOpen = false;
      filePickerPurpose = "image";
      filePickerOpen = true;
      filePickerPath = "/";
      filePickerListing = null;
      selectedFilePath = null;
      void loadFilePicker("/");
    }
    if (action === "undo") {
      restoreEditorRange();
      undoNotesRichEditor(body);
      syncEditorToolbar();
    }
    if (action === "add-reference") {
      referenceNoteId = note.id;
      referenceChooserOpen = !referenceChooserOpen;
      filePickerOpen = false;
      filePickerOrdinal += 1;
      selectedFilePath = null;
      render();
    }
    if (action === "add-link-reference") {
      referenceNoteId = note.id;
      const href = windowObject.prompt?.("Cole o endereço da referência:");
      if (!href) return;
      let valid;
      try {
        const parsed = new URL(href);
        valid = WEB_PROTOCOLS.includes(parsed.protocol);
      } catch {
        valid = false;
      }
      if (!valid) {
        windowObject.alert?.("Use um endereço da web válido.");
        return;
      }
      const title = windowObject.prompt?.("Título da referência:", hostFromHref(href)) || hostFromHref(href);
      resetReferenceFlow();
      runtime.addReference(note.id, { kind: "link", title, detail: "Link", href });
    }
    if (action === "add-file-reference" && filePort) {
      referenceNoteId = note.id;
      referenceChooserOpen = false;
      filePickerPurpose = "file";
      filePickerOpen = true;
      filePickerPath = "/";
      filePickerListing = null;
      selectedFilePath = null;
      void loadFilePicker("/");
    }
    if (action === "close-file-picker") {
      resetReferenceFlow();
      render();
    }
    if (action === "file-picker-up" && filePort) {
      void loadFilePicker(parentLogicalPath(filePickerPath));
    }
    if (action === "file-picker-open-directory" && filePort) {
      void loadFilePicker(actionNode.dataset.filePath);
    }
    if (action === "file-picker-select-file") {
      selectedFilePath = actionNode.dataset.filePath;
      render();
    }
    if (action === "attach-file-reference" && selectedFilePath && referenceNoteId === note.id) {
      const path = selectedFilePath;
      const purpose = filePickerPurpose;
      const title = path.split("/").filter(Boolean).at(-1) || "Arquivo";
      resetReferenceFlow();
      runtime.addReference(note.id, {
        kind: "file",
        title,
        detail: purpose === "image" ? "Imagem local" : "Arquivo local",
        path,
      });
    }
    if (action === "open-file-reference" && activationPort) {
      const path = actionNode.dataset.filePath;
      if (path) activationPort.publish({ appId: "files", target: parentLogicalPath(path) });
    }
    if (action === "remove-reference") {
      runtime.removeReference(note.id, actionNode.dataset.referenceId);
    }
  };

  const onInput = (event) => {
    if (!mountedSlot?.contains(event.target)) return;
    if (event.target.matches("[data-notes-search]")) {
      query = event.target.value.trim();
      renderList(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (event.target.matches("[data-notes-title], [data-notes-body]")) {
      if (event.target.matches("[data-notes-body]")) {
        normalizeNotesRichEditor(event.target);
        lastEditorRange = captureNotesRichSelection(event.target) ?? lastEditorRange;
        syncEditorToolbar();
      }
      scheduleSave();
      if (event.target.matches("[data-notes-title]")) {
        event.target.style.height = "auto";
        event.target.style.height = `${Math.min(150, Math.max(58, event.target.scrollHeight))}px`;
      }
    }
  };

  const onChange = (event) => {
    if (!mountedSlot?.contains(event.target)) return;
    const note = currentNote();
    if (!note) return;
    if (event.target.matches("[data-notes-task-done]")) {
      runtime.updateTask(note.id, event.target.dataset.taskId, { done: event.target.checked });
    }
    if (event.target.matches("[data-notes-task-text]")) {
      runtime.updateTask(note.id, event.target.dataset.taskId, { text: event.target.value });
    }
    if (event.target.matches("[data-notes-format]")) {
      const body = mountedSlot.querySelector("[data-notes-body]");
      restoreEditorRange();
      const blockType = {
        text: "paragraph",
        h2: "heading",
        list: "bullet",
        quote: "quote",
      }[event.target.value] ?? "paragraph";
      setNotesRichBlockType(body, blockType);
      syncEditorToolbar();
    }
  };

  const onPointerDown = (event) => {
    const actionNode = event.target.closest?.("[data-notes-action]");
    if (!actionNode || !mountedSlot?.contains(actionNode)) return;
    if (EDITOR_FORMAT_ACTIONS.has(actionNode.dataset.notesAction)) {
      event.preventDefault();
    }
  };

  const onPaste = (event) => {
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (body && (event.target === body || body.contains(event.target))) {
      pastePlainTextIntoNotesEditor(body, event);
    }
  };

  const onDrop = (event) => {
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (body && (event.target === body || body.contains(event.target))) {
      preventNotesRichDrop(event);
    }
  };

  const onSelectionChange = () => {
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (!body) return;
    const range = captureNotesRichSelection(body);
    if (range) {
      lastEditorRange = range;
      syncEditorToolbar();
    }
  };

  const onWorkspaceKeyDown = (event) => {
    if (!mountedSlot?.contains(event.target) || event.isComposing) return;

    if (event.key === "Enter" && event.target.matches?.("[data-notes-title]")) {
      event.preventDefault();
      flushEditor();
      focusEditorBody();
      return;
    }

    if (event.key !== "Escape") return;
    let handled = false;

    if (event.target.matches?.("[data-notes-search]") && event.target.value) {
      event.target.value = "";
      query = "";
      handled = true;
    }

    const menu = mountedSlot.querySelector(".ordax-notes-menu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      handled = true;
    }

    if (projectMenuId !== null) {
      projectMenuId = null;
      handled = true;
    }

    if (referenceChooserOpen || filePickerOpen) {
      resetReferenceFlow();
      handled = true;
    }

    if (!handled) return;
    event.preventDefault();
    render();
  };

  const onEditorKeyDown = (event) => {
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (!body || !(event.target === body || body.contains(event.target))) return;

    if (handleNotesRichBlockKeyDown(body, event)) {
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier || event.altKey) return;

    const key = String(event.key ?? "").toLocaleLowerCase("en-US");
    if (key === "s") {
      event.preventDefault();
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      flushEditor();
      syncEditorToolbar();
      return;
    }
    if (key === "b") {
      event.preventDefault();
      toggleNotesRichInlineMark(body, "bold");
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "i") {
      event.preventDefault();
      toggleNotesRichInlineMark(body, "italic");
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "k") {
      event.preventDefault();
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      promptEditorLink(body);
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoNotesRichEditor(body);
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
    }
  };

  const onReferenceOpen = (event) => {
    const editorLink = event.target.closest?.("[data-notes-body] a");
    if (editorLink && mountedSlot?.contains(editorLink)) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest(".ordax-notes-ref-card[data-href]");
    if (!card || event.target.closest("[data-notes-action]")) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    windowObject.open?.(card.dataset.href, "_blank", "noopener,noreferrer");
  };

  root.addEventListener("click", onClick);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("paste", onPaste);
  root.addEventListener("drop", onDrop);
  root.addEventListener("keydown", onWorkspaceKeyDown);
  root.addEventListener("keydown", onEditorKeyDown);
  root.addEventListener("dblclick", onReferenceOpen);
  root.addEventListener("keydown", onReferenceOpen);
  documentObject.addEventListener("selectionchange", onSelectionChange);
  const unsubscribeRuntime = runtime.subscribe((next) => {
    state = next;
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  render();

  return Object.freeze({
    destroy() {
      destroyed = true;
      filePickerOrdinal += 1;
      releaseAllImagePreviews();
      flushEditor();
      unsubscribeRuntime?.();
      unsubscribeRender?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("keydown", onWorkspaceKeyDown);
      root.removeEventListener("keydown", onEditorKeyDown);
      root.removeEventListener("dblclick", onReferenceOpen);
      root.removeEventListener("keydown", onReferenceOpen);
      documentObject.removeEventListener("selectionchange", onSelectionChange);
      lastEditorRange = null;
      mountedSlot = null;
    },
  });
}
