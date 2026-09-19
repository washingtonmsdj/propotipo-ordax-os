import { assertNotesRuntime } from "../../services/notes/runtime.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const NOTES_WINDOW_SELECTOR = '[data-window-id="notes"]';
const NOTES_EXTENSION_SELECTOR = '[data-app-extension="notes-workspace"]';
const SAVE_DELAY_MS = 320;
const WEB_PROTOCOLS = Object.freeze(["http:", "https:"]);

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

function firstBodyLine(body) {
  return body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Nota sem conteúdo";
}

function noteMatchesQuery(note, query) {
  if (!query) return true;
  const haystack = [
    note.title,
    note.body,
    ...note.tasks.map((task) => task.text),
    ...note.references.flatMap((reference) => [reference.title, reference.detail, reference.href]),
  ].join("\n").toLocaleLowerCase("pt-BR");
  return haystack.includes(query.toLocaleLowerCase("pt-BR"));
}

function visibleNotes(documentState, mode, query) {
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
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function wrapSelection(textarea, before, after = before, fallback = "texto") {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const selected = textarea.value.slice(start, end) || fallback;
  textarea.setRangeText(`${before}${selected}${after}`, start, end, "select");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function prefixSelectedLines(textarea, prefix) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndRaw = textarea.value.indexOf("\n", end);
  const lineEnd = lineEndRaw < 0 ? textarea.value.length : lineEndRaw;
  const selected = textarea.value.slice(lineStart, lineEnd);
  const next = selected.split("\n").map((line) => `${prefix}${line}`).join("\n");
  textarea.setRangeText(next, lineStart, lineEnd, "select");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
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
  const sort = button(documentObject, "ordax-notes-sort", "Ordenar por atualização", "sort", "≡");
  listHeader.append(listHeading, sort);
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
  menu.append(button(documentObject, "ordax-notes-menu-item", "Mover nota para lixeira", "trash-note", "Mover para a lixeira"));
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
    button(documentObject, "ordax-notes-tool", "Negrito", "bold", "B"),
    button(documentObject, "ordax-notes-tool ordax-notes-tool-italic", "Itálico", "italic", "I"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", "Adicionar item de checklist", "add-task", "☑"),
    button(documentObject, "ordax-notes-tool", "Inserir link no texto", "insert-link", "↗"),
    button(documentObject, "ordax-notes-tool", "Inserir marcação de imagem", "insert-image", "▧"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", "Desfazer", "undo", "↶"),
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
  title.dataset.notesTitle = "";
  title.setAttribute("aria-label", "Título da nota");
  form.append(title);
  form.append(node(documentObject, "div", "ordax-notes-meta"));
  const body = node(documentObject, "textarea", "ordax-notes-body");
  body.rows = 14;
  body.maxLength = 65536;
  body.spellcheck = true;
  body.dataset.notesBody = "";
  body.setAttribute("aria-label", "Conteúdo da nota");
  form.append(body);
  const tasksSection = node(documentObject, "section", "ordax-notes-tasks");
  tasksSection.append(node(documentObject, "h3", "", "Para hoje"), node(documentObject, "div", "ordax-notes-task-list"));
  form.append(tasksSection);
  const quote = node(documentObject, "blockquote", "ordax-notes-quote", "Começar pequeno. Manter o que importa.");
  form.append(quote);
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
  refs.append(addRef, node(documentObject, "p", "ordax-notes-refs-caption", "Fontes próximas das suas ideias."));

  view.append(nav, list, editor, refs);
  return view;
}

export function mountNotesWorkspaceControls(root, notesRuntime, surfaceLifecycle = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("Notes workspace controls require a Surface root Element");
  }
  const runtime = assertNotesRuntime(notesRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView ?? globalThis.window;

  let state = runtime.getSnapshot();
  let mode = "project";
  let query = "";
  let referencesOpen = true;
  let mountedSlot = null;
  let saveTimer = null;
  let pendingNoteId = null;

  const currentNote = () => {
    const id = state.document.selectedNoteId;
    return state.document.notes.find((note) => note.id === id) ?? null;
  };

  const flushEditor = () => {
    if (!mountedSlot || pendingNoteId === null) return;
    if (saveTimer !== null) {
      windowObject.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const title = mountedSlot.querySelector("[data-notes-title]");
    const body = mountedSlot.querySelector("[data-notes-body]");
    const noteId = pendingNoteId;
    pendingNoteId = null;
    runtime.updateNote(noteId, { title: title?.value ?? "", body: body?.value ?? "" });
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
      const title = mountedSlot.querySelector("[data-notes-title]");
      const body = mountedSlot.querySelector("[data-notes-body]");
      runtime.updateNote(noteId, { title: title?.value ?? "", body: body?.value ?? "" });
    }, SAVE_DELAY_MS);
  };

  const renderProjects = (view) => {
    const projects = view.querySelector(".ordax-notes-projects");
    projects.replaceChildren();
    for (const project of state.document.projects) {
      const projectButton = button(documentObject, "ordax-notes-project", `Abrir projeto ${project.name}`, "select-project", "");
      projectButton.dataset.projectId = project.id;
      projectButton.dataset.active = String(mode === "project" && project.id === state.document.selectedProjectId);
      projectButton.append(node(documentObject, "span", "ordax-notes-project-icon", "□"), node(documentObject, "span", "", project.name));
      projects.append(projectButton);
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
    const items = visibleNotes(state.document, mode, query);
    view.querySelector(".ordax-notes-list-title").textContent = modeLabel();
    view.querySelector(".ordax-notes-list-count").textContent = `${items.length} ${items.length === 1 ? "nota" : "notas"}`;
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

  const renderTasks = (view, note) => {
    const taskList = view.querySelector(".ordax-notes-task-list");
    taskList.replaceChildren();
    const section = view.querySelector(".ordax-notes-tasks");
    section.hidden = note.tasks.length === 0;
    for (const task of note.tasks) {
      const label = node(documentObject, "label", "ordax-notes-task");
      label.dataset.done = String(task.done);
      const checkbox = node(documentObject, "input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.dataset.taskId = task.id;
      checkbox.dataset.notesTaskDone = "";
      const text = node(documentObject, "input", "ordax-notes-task-text");
      text.type = "text";
      text.value = task.text;
      text.maxLength = 2048;
      text.dataset.taskId = task.id;
      text.dataset.notesTaskText = "";
      text.setAttribute("aria-label", "Texto do item");
      label.append(checkbox, text);
      taskList.append(label);
    }
  };

  const renderReferences = (view, note) => {
    const panel = view.querySelector("[data-notes-references]");
    panel.hidden = !referencesOpen;
    const refs = view.querySelector(".ordax-notes-refs-content");
    refs.replaceChildren();
    refs.append(node(documentObject, "span", "ordax-notes-refs-kicker", "DESTA NOTA"));
    if (note.references.length === 0) {
      refs.append(node(documentObject, "p", "ordax-notes-refs-empty", "Nenhuma referência adicionada."));
      return;
    }
    const links = note.references.filter((reference) => reference.kind === "link");
    const files = note.references.filter((reference) => reference.kind === "file");
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
        const card = node(documentObject, "article", "ordax-notes-ref-card");
        const copy = node(documentObject, "span", "ordax-notes-ref-copy");
        copy.append(node(documentObject, "strong", "", reference.title), node(documentObject, "span", "", reference.detail || "Arquivo"));
        const remove = button(documentObject, "ordax-notes-ref-remove", "Remover referência", "remove-reference", "×");
        remove.dataset.referenceId = reference.id;
        card.append(node(documentObject, "span", "ordax-notes-ref-icon", "▱"), copy, remove);
        refs.append(card);
      }
    }
  };

  const renderEditor = (view) => {
    const note = currentNote();
    const empty = view.querySelector("[data-notes-empty]");
    const documentView = view.querySelector("[data-notes-document]");
    const controls = view.querySelectorAll(".ordax-notes-toolbar button, .ordax-notes-format, .ordax-notes-star, .ordax-notes-more");
    for (const control of controls) control.disabled = !note;

    if (!note) {
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
      body.value = note.body;
      view.dataset.renderedNoteId = note.id;
    } else {
      if (active !== title && pendingNoteId !== note.id) title.value = note.title;
      if (active !== body && pendingNoteId !== note.id) body.value = note.body;
    }
    title.style.height = "auto";
    title.style.height = `${Math.min(150, Math.max(58, title.scrollHeight))}px`;

    const meta = view.querySelector(".ordax-notes-meta");
    meta.textContent = `${project?.name ?? "Meu espaço"}  ·  Nota local`;
    const star = view.querySelector(".ordax-notes-star");
    star.textContent = note.favorite ? "★" : "☆";
    star.setAttribute("aria-label", note.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos");
    const menuAction = view.querySelector(".ordax-notes-menu-item");
    menuAction.textContent = note.deletedAt === null ? "Mover para a lixeira" : "Restaurar nota";
    menuAction.dataset.notesAction = note.deletedAt === null ? "trash-note" : "restore-note";
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
    const first = visibleNotes(state.document, mode, query)[0];
    if (first) runtime.selectNote(first.id);
  };

  const onClick = (event) => {
    const actionNode = event.target.closest("[data-notes-action]");
    if (!actionNode || !mountedSlot?.contains(actionNode)) return;
    const action = actionNode.dataset.notesAction;
    const note = currentNote();

    if (action === "new-note") {
      flushEditor();
      mode = "project";
      runtime.createNote(state.document.selectedProjectId);
      queueMicrotask(() => mountedSlot?.querySelector("[data-notes-title]")?.select());
      return;
    }
    if (action === "new-project") {
      const name = windowObject.prompt?.("Nome do novo projeto:");
      if (name?.trim()) {
        flushEditor();
        mode = "project";
        runtime.createProject(name);
      }
      return;
    }
    if (action === "select-project") {
      flushEditor();
      mode = "project";
      runtime.selectProject(actionNode.dataset.projectId);
      return;
    }
    if (action === "select-note") {
      flushEditor();
      runtime.selectNote(actionNode.dataset.noteId);
      return;
    }
    if (["view-all", "view-favorites", "view-recent", "view-trash"].includes(action)) {
      flushEditor();
      mode = action.replace("view-", "");
      render();
      const selected = currentNote();
      const visible = visibleNotes(state.document, mode, query);
      if (!selected || !visible.some((item) => item.id === selected.id)) selectFirstVisible();
      return;
    }
    if (!note) return;

    const body = mountedSlot.querySelector("[data-notes-body]");
    if (action === "favorite") runtime.toggleFavorite(note.id);
    if (action === "add-task") runtime.addTask(note.id);
    if (action === "trash-note") runtime.trashNote(note.id);
    if (action === "restore-note") runtime.restoreNote(note.id);
    if (action === "toggle-references") {
      referencesOpen = !referencesOpen;
      render();
    }
    if (action === "toggle-menu") {
      const menu = mountedSlot.querySelector(".ordax-notes-menu");
      menu.hidden = !menu.hidden;
    }
    if (action === "bold") wrapSelection(body, "**");
    if (action === "italic") wrapSelection(body, "*");
    if (action === "insert-link") wrapSelection(body, "[", "](https://)", "link");
    if (action === "insert-image") wrapSelection(body, "![", "](imagem)", "descrição");
    if (action === "undo") {
      body.focus();
      documentObject.execCommand?.("undo");
      scheduleSave();
    }
    if (action === "add-reference") {
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
      runtime.addReference(note.id, { kind: "link", title, detail: "Link", href });
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
      const prefix = { h2: "## ", list: "- ", quote: "> " }[event.target.value];
      if (prefix) prefixSelectedLines(body, prefix);
      event.target.value = "text";
    }
  };

  const onReferenceOpen = (event) => {
    const card = event.target.closest(".ordax-notes-ref-card[data-href]");
    if (!card || event.target.closest("[data-notes-action]")) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    windowObject.open?.(card.dataset.href, "_blank", "noopener,noreferrer");
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("dblclick", onReferenceOpen);
  root.addEventListener("keydown", onReferenceOpen);
  const unsubscribeRuntime = runtime.subscribe((next) => {
    state = next;
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  render();

  return Object.freeze({
    destroy() {
      flushEditor();
      unsubscribeRuntime?.();
      unsubscribeRender?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("dblclick", onReferenceOpen);
      root.removeEventListener("keydown", onReferenceOpen);
      mountedSlot = null;
    },
  });
}
