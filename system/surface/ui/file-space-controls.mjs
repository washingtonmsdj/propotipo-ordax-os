import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../contracts/file-space.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const FILE_WINDOW_SELECTOR = '[data-window-id="files"]';
const FILE_EXTENSION_SELECTOR = '[data-app-extension="file-space"]';
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

  const renderEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      node(documentObject, "span", "", "Nome"),
      node(documentObject, "span", "", "Tipo"),
      node(documentObject, "span", "", "Tamanho"),
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

    for (const entry of listing.entries) {
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      if (entry.kind === "directory") {
        row.dataset.fileOpenPath = joinPath(listing.path, entry.name);
        row.setAttribute("aria-label", `Abrir pasta ${entry.name}`);
      } else {
        row.dataset.fileReadPath = joinPath(listing.path, entry.name);
        row.setAttribute("aria-label", `Visualizar arquivo ${entry.name}`);
      }
      row.dataset.kind = entry.kind;

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
    const breadcrumb = node(documentObject, "nav", "ordax-files-breadcrumb");
    breadcrumb.setAttribute("aria-label", "Caminho atual");
    renderBreadcrumb(breadcrumb);

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
    toolbar.append(breadcrumb, actions);
    content.append(toolbar);

    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      pending
        ? "Atualizando conteúdo…"
        : listing
          ? `${listing.entries.length} ${listing.entries.length === 1 ? "item" : "itens"}`
          : "Preparando espaço do usuário…",
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);

    renderCreateDirectory(content);
    if (message) content.append(node(documentObject, "p", "ordax-files-message", message));
    renderEntries(content);
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

  const load = async (path) => {
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    creatingDirectory = false;
    directoryDraft = "";
    textPreview = null;
    previewPending = false;
    previewRequestOrdinal += 1;
    replaceView();
    try {
      const next = validateFileListing(await port.list(path));
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return;
      message = "Não foi possível abrir este local.";
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
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
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.includes("413")) {
        message = "Este arquivo é grande demais para a visualização rápida (máximo 256 KB).";
      } else if (detail.includes("415")) {
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
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return;
      message = "A pasta não pôde ser criada. Verifique o nome ou se ela já existe.";
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const onClick = (event) => {
    const read = event.target.closest("[data-file-read-path]");
    if (read && root.contains(read)) {
      void openTextFile(read.dataset.fileReadPath);
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
    const open = event.target.closest("[data-file-open-path]");
    if (open && root.contains(open)) {
      void load(open.dataset.fileOpenPath);
      return;
    }
    const refresh = event.target.closest("[data-file-refresh]");
    if (refresh && listing) {
      void load(listing.path);
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
    if (event.target.matches?.("[data-file-directory-name]")) {
      directoryDraft = event.target.value;
    }
  };

  const onKeyDown = (event) => {
    if (!event.target.matches?.("[data-file-directory-name]")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void createDirectory(directoryDraft);
    } else if (event.key === "Escape" && !pending) {
      creatingDirectory = false;
      directoryDraft = "";
      message = null;
      replaceView();
    }
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
