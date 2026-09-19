import { assertBrowserSessionPort } from "../../contracts/browser-session.mjs";
import { assertProjectCatalogPort } from "../../contracts/project-catalog.mjs";
import { assertProjectWebReferencePort } from "../../contracts/project-web-references.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const INTERNET_WINDOW_SELECTOR = '[data-window-id="internet"]';
const INTERNET_EXTENSION_SELECTOR = '[data-app-extension="internet-browser"]';
const MAX_UI_TABS = 16;
const PROJECT_PANEL_ID = "ordax-internet-project-panel";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function iconButton(documentObject, glyph, label, action) {
  const button = node(documentObject, "button", "ordax-internet-icon-button", glyph);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.dataset.browserAction = action;
  return button;
}

function normalizedAddress(value) {
  const input = value.trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (!/\s/.test(input) && input.includes(".")) return "https:" + "//" + input;
  throw new TypeError("Digite um endereço web, por exemplo: example.org");
}

function displayHost(url) {
  if (!url) return "Nova aba";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function normalizedTabQuery(value) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function tabMatchesQuery(tab, query) {
  if (!query) return true;
  return [tab.title, displayHost(tab.url), tab.url]
    .filter(Boolean)
    .some((value) => value.toLocaleLowerCase("pt-BR").includes(query));
}

function createSidebar(documentObject) {
  const sidebar = node(documentObject, "aside", "ordax-internet-sidebar");
  sidebar.setAttribute("aria-label", "Organização da navegação");
  const workspace = node(documentObject, "button", "ordax-internet-workspace");
  workspace.type = "button";
  workspace.disabled = true;
  workspace.title = "A vinculação ao espaço ativo será conectada por um contrato próprio.";
  workspace.append(node(documentObject, "span", "ordax-internet-workspace-mark", ""));
  workspace.append(node(documentObject, "strong", "", "Espaço atual"));
  workspace.append(node(documentObject, "span", "", "⌄"));

  const newTab = node(documentObject, "button", "ordax-internet-new-tab", "+  Nova aba");
  newTab.type = "button";
  newTab.dataset.browserNewTab = "";

  const search = node(documentObject, "label", "ordax-internet-tab-search");
  search.append(node(documentObject, "span", "ordax-internet-tab-search-icon", "⌕"));
  const searchInput = node(documentObject, "input", "ordax-internet-tab-search-input");
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.placeholder = "Buscar abas…";
  searchInput.setAttribute("aria-label", "Buscar abas abertas");
  searchInput.dataset.browserTabSearch = "";
  search.append(searchInput);

  const label = node(documentObject, "span", "ordax-internet-section-label", "ABAS DO ESPAÇO");
  label.id = "ordax-internet-tabs-label";
  const tabs = node(documentObject, "div", "ordax-internet-tabs");
  tabs.dataset.browserTabs = "";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-labelledby", label.id);
  tabs.setAttribute("aria-orientation", "vertical");

  const collections = node(documentObject, "div", "ordax-internet-collections");
  collections.append(node(documentObject, "span", "ordax-internet-section-label", "COLEÇÕES"));
  for (const [glyph, title] of [["□", "Coleções do espaço"], ["☆", "Ler depois"], ["★", "Favoritos"]]) {
    const row = node(documentObject, "button", "ordax-internet-collection-row");
    row.type = "button";
    row.disabled = true;
    row.title = "Persistência ainda não conectada.";
    row.append(node(documentObject, "span", "", glyph), node(documentObject, "span", "", title));
    collections.append(row);
  }

  const footer = node(documentObject, "div", "ordax-internet-sidebar-footer");
  footer.append(node(documentObject, "span", "", "◷  Histórico"));
  footer.append(node(documentObject, "span", "", "◉  Janela privada"));

  sidebar.append(workspace, newTab, search, label, tabs, collections, footer);
  return sidebar;
}

function createToolbar(documentObject) {
  const toolbar = node(documentObject, "div", "ordax-internet-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Navegação da Internet");
  toolbar.append(
    iconButton(documentObject, "←", "Voltar", "back"),
    iconButton(documentObject, "→", "Avançar", "forward"),
    iconButton(documentObject, "↻", "Recarregar", "reload"),
  );
  const form = node(documentObject, "form", "ordax-internet-address-form");
  form.dataset.browserAddressForm = "";
  const input = node(documentObject, "input", "ordax-internet-address");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Digite um endereço";
  input.setAttribute("aria-label", "Endereço da página");
  input.dataset.browserAddress = "";
  form.append(node(documentObject, "span", "ordax-internet-site-control", "◈"), input);
  toolbar.append(form, iconButton(documentObject, "☆", "Adicionar aos favoritos", "bookmark"));
  const downloads = iconButton(documentObject, "⇩", "Downloads", "downloads");
  downloads.disabled = true;
  downloads.title = "Downloads serão conectados a um contrato de armazenamento próprio.";
  const more = iconButton(documentObject, "⋮", "Mostrar ou recolher painel do projeto", "more");
  more.setAttribute("aria-controls", PROJECT_PANEL_ID);
  more.setAttribute("aria-expanded", "true");
  toolbar.append(downloads, more);
  return toolbar;
}

function createHome(documentObject, supported, reason) {
  const home = node(documentObject, "div", "ordax-internet-home");
  home.dataset.browserHome = "";
  home.append(node(documentObject, "span", "ordax-internet-home-mark", "○"));
  home.append(node(documentObject, "h2", "", "Internet"));
  home.append(node(documentObject, "p", "", "Navegue sem separar a pesquisa do trabalho que você está construindo."));
  if (!supported) {
    const unavailable = node(documentObject, "div", "ordax-internet-unavailable");
    unavailable.append(node(documentObject, "strong", "", "Navegação integrada não disponível neste host"));
    unavailable.append(node(documentObject, "span", "", reason));
    home.append(unavailable);
  } else {
    home.append(node(documentObject, "span", "ordax-internet-home-hint", "Use a barra acima para abrir um endereço web."));
  }
  const cards = node(documentObject, "div", "ordax-internet-home-links");
  for (const [label, value] of [["SESSÃO", "Abra uma página para começar"], ["ESPAÇO", "Integração em preparação"], ["REFERÊNCIAS", "Persistência em preparação"]]) {
    const card = node(documentObject, "div", "ordax-internet-home-link");
    card.append(node(documentObject, "span", "", label), node(documentObject, "strong", "", value));
    cards.append(card);
  }
  home.append(cards);
  return home;
}

function createProjectPanel(documentObject) {
  const panel = node(documentObject, "aside", "ordax-internet-project-panel");
  panel.id = PROJECT_PANEL_ID;
  panel.setAttribute("aria-label", "Contexto do projeto");
  const header = node(documentObject, "div", "ordax-internet-project-header");
  header.append(node(documentObject, "h2", "", "Neste projeto"));
  const close = node(documentObject, "button", "ordax-internet-panel-close", "×");
  close.type = "button";
  close.dataset.browserPanelClose = "";
  close.setAttribute("aria-label", "Recolher painel do projeto");
  header.append(close);

  const intro = node(documentObject, "div", "ordax-internet-project-intro");
  intro.append(node(documentObject, "span", "ordax-internet-section-label", "PROJETO DESTA SESSÃO"));
  const contextName = node(documentObject, "strong", "ordax-internet-project-context-name", "Nenhum projeto selecionado");
  contextName.dataset.browserProjectContextName = "";
  const contextDetail = node(documentObject, "p", "", "Escolha um projeto já cadastrado em Arquivos. A escolha vale apenas para esta sessão do navegador.");
  contextDetail.dataset.browserProjectContextDetail = "";
  intro.append(contextName, contextDetail);

  const projects = node(documentObject, "section", "ordax-internet-project-section");
  projects.append(node(documentObject, "h3", "", "Projetos disponíveis"));
  const projectOptions = node(documentObject, "div", "ordax-internet-project-options");
  projectOptions.dataset.browserProjectOptions = "";
  projects.append(projectOptions);

  const current = node(documentObject, "section", "ordax-internet-project-section");
  current.append(node(documentObject, "h3", "", "Página atual"));
  const page = node(documentObject, "div", "ordax-internet-page-reference");
  page.dataset.browserCurrentPage = "";
  current.append(page);
  const save = node(documentObject, "button", "ordax-internet-save-button", "▱  Salvar no projeto");
  save.type = "button";
  save.dataset.browserSaveProject = "";
  save.disabled = true;
  current.append(save);
  const savedState = node(documentObject, "div", "ordax-internet-reference-state");
  savedState.dataset.browserReferenceState = "";
  savedState.hidden = true;
  current.append(savedState);

  const note = node(documentObject, "section", "ordax-internet-project-section");
  note.append(node(documentObject, "h3", "", "Sua nota"));
  const textarea = node(documentObject, "textarea", "ordax-internet-note");
  textarea.rows = 3;
  textarea.placeholder = "Adicione uma observação sobre esta referência";
  textarea.dataset.browserReferenceNote = "";
  textarea.disabled = true;
  textarea.maxLength = 4096;
  const noteHint = node(documentObject, "span", "ordax-internet-project-pending");
  noteHint.dataset.browserReferenceNoteHint = "";
  note.append(textarea, noteHint);

  const materials = node(documentObject, "section", "ordax-internet-project-section");
  materials.append(node(documentObject, "h3", "", "Contexto do projeto"));
  const projectFolder = node(documentObject, "div", "ordax-internet-material-row");
  projectFolder.dataset.browserProjectFolder = "";
  materials.append(projectFolder);

  const assistance = node(documentObject, "section", "ordax-internet-assistance");
  assistance.append(node(documentObject, "h3", "", "✦  Assistência opcional"));
  const ask = node(documentObject, "button", "ordax-internet-ask-button", "▢  Perguntar sobre esta página");
  ask.type = "button";
  ask.disabled = true;
  assistance.append(ask, node(documentObject, "span", "", "Você escolhe o contexto. A integração de IA permanece separada do engine web."));

  panel.append(header, intro, projects, current, note, materials, assistance);
  return panel;
}

function createView(documentObject, snapshot) {
  const view = node(documentObject, "div", "ordax-internet-view");
  view.dataset.ordaxInternetView = "";
  const toolbar = createToolbar(documentObject);
  const body = node(documentObject, "div", "ordax-internet-body");
  const center = node(documentObject, "main", "ordax-internet-center");
  const viewport = node(documentObject, "div", "ordax-internet-viewport");
  viewport.dataset.browserViewport = "";
  viewport.append(createHome(documentObject, snapshot.supported, snapshot.reason));
  center.append(viewport);
  body.append(createSidebar(documentObject), center, createProjectPanel(documentObject));
  view.append(toolbar, body);
  return view;
}

export function mountInternetBrowserControls(
  root,
  browserSession,
  surfaceLifecycle,
  { projects = null, projectReferences = null } = {},
) {
  if (!(root instanceof Element)) throw new TypeError("Internet controls require a Surface root Element");
  const port = assertBrowserSessionPort(browserSession);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const projectPort = projects === null ? null : assertProjectCatalogPort(projects);
  const referencePort = projectReferences === null
    ? null
    : assertProjectWebReferencePort(projectReferences);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  let snapshot = port.getSnapshot();
  let projectSnapshot = projectPort?.getSnapshot() ?? null;
  let referenceSnapshot = referencePort?.getSnapshot() ?? null;
  let selectedProjectId = null;
  let noteDraftKey = "";
  let noteDraftValue = "";
  let mountedSlot = null;
  let destroyed = false;
  let nextTabOrdinal = 1;
  let message = "";
  let panelCollapsed = false;
  let tabQuery = "";
  let pendingTabFocusId = null;
  let handledSurfaceTarget = null;
  let resizeObserver = null;

  const findSlot = () => root.querySelector(`${INTERNET_WINDOW_SELECTOR} ${INTERNET_EXTENSION_SELECTOR}`);
  const activeTab = () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const selectedProject = () => projectSnapshot?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const activeSavedReference = () => {
    const tab = activeTab();
    if (!referenceSnapshot || !selectedProjectId || !tab?.url) return null;
    return referenceSnapshot.references.find((reference) => (
      reference.projectId === selectedProjectId && reference.url === tab.url
    )) ?? null;
  };

  const currentReferenceKey = () => {
    const tab = activeTab();
    return selectedProjectId && tab?.url ? `${selectedProjectId}\u0000${tab.url}` : "";
  };

  const syncNoteDraft = () => {
    const key = currentReferenceKey();
    if (key === noteDraftKey) return;
    noteDraftKey = key;
    noteDraftValue = key ? (activeSavedReference()?.note ?? "") : "";
  };

  const allocateTabId = () => {
    while (snapshot.tabs.some((tab) => tab.id === `tab-${nextTabOrdinal}`)) nextTabOrdinal += 1;
    return `tab-${nextTabOrdinal++}`;
  };

  const visibleTabs = () => {
    const query = normalizedTabQuery(tabQuery);
    return snapshot.tabs.filter((tab) => tabMatchesQuery(tab, query));
  };

  const findTabButton = (slot, tabId) => [...(slot?.querySelectorAll("[data-browser-tab-id]") ?? [])]
    .find((button) => button.dataset.browserTabId === tabId) ?? null;

  const focusTab = (tabId) => {
    windowObject.requestAnimationFrame(() => {
      findTabButton(findSlot(), tabId)?.focus({ preventScroll: true });
    });
  };

  const focusProject = (projectId) => {
    windowObject.requestAnimationFrame(() => {
      const slot = findSlot();
      const option = [...(slot?.querySelectorAll("[data-browser-project-id]") ?? [])]
        .find((button) => button.dataset.browserProjectId === projectId) ?? null;
      option?.focus({ preventScroll: true });
    });
  };

  const syncViewport = () => {
    if (destroyed) return;
    const slot = findSlot();
    const viewport = slot?.querySelector("[data-browser-viewport]") ?? null;
    const tab = activeTab();
    if (!viewport || !snapshot.supported || !tab?.url || !slot.isConnected) {
      port.setViewport({ visible: false, x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const visible = rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.right > 0
      && rect.top < windowObject.innerHeight && rect.left < windowObject.innerWidth;
    port.setViewport({
      visible,
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    });
  };

  const syncSurfaceTarget = () => {
    const target = lifecycle.getAppTarget("internet");
    if (target === null) {
      handledSurfaceTarget = null;
      return;
    }
    if (target === handledSurfaceTarget || !snapshot.supported) return;

    handledSurfaceTarget = target;
    try {
      const url = normalizedAddress(target);
      if (!url) return;
      const tab = activeTab();
      message = "";
      if (tab) {
        if (tab.url !== url) port.navigate(tab.id, url);
      } else {
        port.openTab(allocateTabId(), url);
      }
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : "Não foi possível abrir o endereço recebido.";
    }
  };

  const ensureTab = () => {
    if (!snapshot.supported || snapshot.tabs.length > 0) return;
    port.openTab(allocateTabId(), "");
  };

  const syncTabs = (slot) => {
    const tabs = slot.querySelector("[data-browser-tabs]");
    if (!tabs) return;
    const searchInput = slot.querySelector("[data-browser-tab-search]");
    if (searchInput && documentObject.activeElement !== searchInput && searchInput.value !== tabQuery) {
      searchInput.value = tabQuery;
    }

    const focusedTabId = documentObject.activeElement?.dataset?.browserTabId ?? null;
    tabs.replaceChildren();
    const query = normalizedTabQuery(tabQuery);
    const filteredTabs = visibleTabs();
    const activeVisible = filteredTabs.some((tab) => tab.id === snapshot.activeTabId);
    for (const tab of filteredTabs) {
      const row = node(documentObject, "div", "ordax-internet-tab");
      row.dataset.selected = String(tab.id === snapshot.activeTabId);
      row.setAttribute("role", "presentation");

      const activate = node(documentObject, "button", "ordax-internet-tab-activate");
      activate.type = "button";
      activate.dataset.browserTabId = tab.id;
      activate.setAttribute("role", "tab");
      activate.setAttribute("aria-selected", String(tab.id === snapshot.activeTabId));
      activate.tabIndex = (
        tab.id === snapshot.activeTabId
        || (!activeVisible && tab.id === filteredTabs[0]?.id)
      ) ? 0 : -1;
      activate.append(node(documentObject, "span", "ordax-internet-tab-icon", tab.loading ? "◌" : "▤"));
      activate.append(node(documentObject, "span", "ordax-internet-tab-title", tab.title || displayHost(tab.url)));
      row.append(activate);

      if (snapshot.tabs.length > 1) {
        const close = node(documentObject, "button", "ordax-internet-tab-close", "×");
        close.type = "button";
        close.dataset.browserCloseTab = tab.id;
        close.setAttribute("aria-label", `Fechar ${tab.title || "aba"}`);
        row.append(close);
      }
      tabs.append(row);
    }
    if (query && filteredTabs.length === 0) {
      tabs.append(node(documentObject, "div", "ordax-internet-tab-placeholder", "Nenhuma aba encontrada."));
    } else if (!snapshot.supported && snapshot.tabs.length === 0) {
      tabs.append(node(documentObject, "div", "ordax-internet-tab-placeholder", "Navegação local"));
    }
    if (focusedTabId && filteredTabs.some((tab) => tab.id === focusedTabId)) {
      focusTab(focusedTabId);
    }
  };

  const syncProjectContext = (slot) => {
    const options = slot.querySelector("[data-browser-project-options]");
    const contextName = slot.querySelector("[data-browser-project-context-name]");
    const contextDetail = slot.querySelector("[data-browser-project-context-detail]");
    const folder = slot.querySelector("[data-browser-project-folder]");
    const selected = selectedProject();

    if (contextName) contextName.textContent = selected?.name ?? "Nenhum projeto selecionado";
    if (contextDetail) {
      if (selected) {
        contextDetail.textContent = `Contexto local da sessão · ${selected.path}`;
      } else if (projectSnapshot) {
        contextDetail.textContent = "Escolha um projeto já cadastrado em Arquivos. A escolha vale apenas para esta sessão do navegador.";
      } else {
        contextDetail.textContent = "O catálogo local de projetos não está disponível neste host.";
      }
    }

    if (folder) {
      folder.replaceChildren();
      folder.append(node(documentObject, "span", "", selected ? "□" : "○"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", selected ? "Pasta do projeto" : "Sem contexto de projeto"));
      copy.append(node(documentObject, "small", "", selected?.path ?? "Selecione um projeto para relacionar a pesquisa à sessão."));
      folder.append(copy);
    }

    if (!options) return;
    const projectEntries = projectSnapshot?.projects ?? [];
    const renderKey = JSON.stringify([
      selectedProjectId,
      projectSnapshot?.persistence ?? "unavailable",
      ...projectEntries.flatMap((project) => [project.id, project.name, project.path]),
    ]);
    if (options.dataset.browserProjectRenderKey === renderKey) return;
    options.dataset.browserProjectRenderKey = renderKey;
    options.replaceChildren();

    if (!projectSnapshot) {
      options.append(node(documentObject, "div", "ordax-internet-tab-placeholder", "Catálogo de projetos indisponível neste host."));
      return;
    }
    if (projectEntries.length === 0) {
      options.append(node(documentObject, "div", "ordax-internet-tab-placeholder", "Nenhum projeto cadastrado em Arquivos."));
      return;
    }

    for (const project of projectEntries) {
      const row = node(documentObject, "button", "ordax-internet-material-row ordax-internet-project-option");
      row.type = "button";
      row.dataset.browserProjectId = project.id;
      row.setAttribute("aria-pressed", String(project.id === selectedProjectId));
      row.title = `Usar ${project.name} como contexto desta sessão do navegador`;
      row.append(node(documentObject, "span", "", project.id === selectedProjectId ? "●" : "○"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", project.name));
      copy.append(node(documentObject, "small", "", project.path));
      row.append(copy, node(documentObject, "span", "", project.id === selectedProjectId ? "ATUAL" : ""));
      options.append(row);
    }
  };

  const syncCurrentPage = (slot) => {
    const tab = activeTab();
    const reference = slot.querySelector("[data-browser-current-page]");
    if (reference) {
      reference.replaceChildren();
      reference.append(node(documentObject, "span", "ordax-internet-page-icon", "▤"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", tab?.title || (tab?.url ? displayHost(tab.url) : "Nova aba")));
      copy.append(node(documentObject, "small", "", tab?.url ? displayHost(tab.url) : "Nenhuma página aberta"));
      reference.append(copy);
    }
    const address = slot.querySelector("[data-browser-address]");
    if (address && documentObject.activeElement !== address) address.value = tab?.url ?? "";
    for (const button of slot.querySelectorAll("[data-browser-action]")) {
      const action = button.dataset.browserAction;
      if (action === "back") button.disabled = !tab?.canGoBack;
      if (action === "forward") button.disabled = !tab?.canGoForward;
      if (action === "reload") button.disabled = !tab?.url;
    }
    const viewport = slot.querySelector("[data-browser-viewport]");
    const home = viewport?.querySelector("[data-browser-home]");
    if (home) home.hidden = Boolean(tab?.url);
    let status = slot.querySelector("[data-browser-message]");
    if (!status && message) {
      status = node(documentObject, "div", "ordax-internet-message");
      status.dataset.browserMessage = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      slot.querySelector(".ordax-internet-center")?.append(status);
    }
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }
  };

  const syncReferenceControls = (slot) => {
    syncNoteDraft();
    const tab = activeTab();
    const project = selectedProject();
    const saved = activeSavedReference();
    const available = Boolean(referencePort && project && tab?.url);

    const save = slot.querySelector("[data-browser-save-project]");
    if (save) {
      save.disabled = !available;
      save.textContent = saved ? "▱  Atualizar no projeto" : "▱  Salvar no projeto";
      save.title = !referencePort
        ? "Referências de projeto não estão disponíveis neste host."
        : !project
          ? "Selecione um projeto para salvar esta página."
          : !tab?.url
            ? "Abra uma página antes de salvá-la."
            : saved
              ? "Atualizar título e nota desta referência."
              : "Salvar a página atual como referência explícita deste projeto.";
    }

    const textarea = slot.querySelector("[data-browser-reference-note]");
    if (textarea) {
      textarea.disabled = !available;
      if (documentObject.activeElement !== textarea && textarea.value !== noteDraftValue) {
        textarea.value = noteDraftValue;
      }
    }

    const hint = slot.querySelector("[data-browser-reference-note-hint]");
    if (hint) {
      hint.textContent = !referencePort
        ? "Persistência de referências indisponível neste host."
        : !project
          ? "Selecione um projeto para relacionar uma nota à página."
          : !tab?.url
            ? "Abra uma página para adicionar contexto."
            : saved
              ? "A nota é salva junto desta referência."
              : "A nota será salva junto com a página.";
    }

    const stateNode = slot.querySelector("[data-browser-reference-state]");
    if (stateNode) {
      stateNode.replaceChildren();
      stateNode.hidden = !saved;
      if (saved) {
        const copy = node(
          documentObject,
          "span",
          "ordax-internet-reference-state-copy",
          referenceSnapshot?.persistence === "device"
            ? "Salvo neste dispositivo"
            : "Salvo somente nesta sessão",
        );
        const remove = node(
          documentObject,
          "button",
          "ordax-internet-reference-remove",
          "Remover",
        );
        remove.type = "button";
        remove.dataset.browserRemoveReference = saved.id;
        remove.setAttribute("aria-label", "Remover página salva do projeto");
        stateNode.append(copy, remove);
      }
    }
  };

  const syncPanel = (slot) => {
    const panel = slot.querySelector(`#${PROJECT_PANEL_ID}`);
    panel?.toggleAttribute("hidden", panelCollapsed);
    slot.querySelector(".ordax-internet-body")?.classList.toggle("project-collapsed", panelCollapsed);
    const toggle = slot.querySelector('[data-browser-action="more"]');
    toggle?.setAttribute("aria-expanded", String(!panelCollapsed));
  };

  const render = () => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      syncViewport();
      return;
    }
    if (mountedSlot !== slot || !slot.dataset.ordaxInternetMounted) {
      slot.replaceChildren(createView(documentObject, snapshot));
      slot.dataset.ordaxInternetMounted = "true";
      mountedSlot = slot;
      resizeObserver?.disconnect();
      if (typeof windowObject.ResizeObserver === "function") {
        resizeObserver = new windowObject.ResizeObserver(syncViewport);
        resizeObserver.observe(slot.querySelector("[data-browser-viewport]"));
      }
    }
    syncSurfaceTarget();
    syncTabs(slot);
    syncProjectContext(slot);
    syncCurrentPage(slot);
    syncReferenceControls(slot);
    syncPanel(slot);
    windowObject.requestAnimationFrame(syncViewport);
    ensureTab();
  };

  const onClick = (event) => {
    const target = event.target.closest("button");
    if (!target || !root.contains(target)) return;
    const slot = findSlot();
    if (!slot?.contains(target)) return;

    const projectId = target.dataset.browserProjectId;
    if (projectId) {
      if (!projectPort) return;
      try {
        projectPort.recordOpened(projectId);
        selectedProjectId = projectId;
        message = "";
      } catch (error) {
        message = error instanceof Error ? error.message : "Não foi possível abrir o contexto do projeto.";
      }
      render();
      focusProject(projectId);
      return;
    }

    if (target.dataset.browserSaveProject !== undefined) {
      const tab = activeTab();
      const project = selectedProject();
      if (!referencePort || !project || !tab?.url) return;
      try {
        referencePort.save({
          projectId: project.id,
          url: tab.url,
          title: tab.title || displayHost(tab.url),
          note: noteDraftValue,
        });
        projectPort?.recordOpened(project.id);
        message = referenceSnapshot?.persistence === "session"
          ? "Referência salva para esta sessão."
          : "Referência salva no projeto.";
      } catch (error) {
        message = error instanceof Error ? error.message : "Não foi possível salvar a referência.";
      }
      render();
      return;
    }

    const removeReferenceId = target.dataset.browserRemoveReference;
    if (removeReferenceId) {
      if (!referencePort) return;
      try {
        referencePort.remove(removeReferenceId);
        noteDraftValue = "";
        message = "Referência removida do projeto.";
      } catch (error) {
        message = error instanceof Error ? error.message : "Não foi possível remover a referência.";
      }
      render();
      return;
    }

    const closeTabId = target.dataset.browserCloseTab;
    if (closeTabId) {
      event.preventDefault();
      event.stopPropagation();
      const tabs = visibleTabs();
      const closingIndex = tabs.findIndex((tab) => tab.id === closeTabId);
      pendingTabFocusId = tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? null;
      port.closeTab(closeTabId);
      return;
    }
    const tabId = target.dataset.browserTabId;
    if (tabId) {
      port.activateTab(tabId);
      return;
    }
    if (target.dataset.browserNewTab !== undefined) {
      if (snapshot.tabs.length >= MAX_UI_TABS) {
        message = "Limite de 16 abas nesta versão do protótipo.";
        render();
        return;
      }
      port.openTab(allocateTabId(), "");
      return;
    }
    if (target.dataset.browserPanelClose !== undefined) {
      panelCollapsed = true;
      render();
      findSlot()?.querySelector('[data-browser-action="more"]')?.focus({ preventScroll: true });
      return;
    }
    const action = target.dataset.browserAction;
    if (!action) return;
    if (action === "more") {
      panelCollapsed = !panelCollapsed;
      render();
      return;
    }
    const tab = activeTab();
    if (!tab) return;
    if (action === "back") port.goBack(tab.id);
    if (action === "forward") port.goForward(tab.id);
    if (action === "reload") port.reload(tab.id);
    if (action === "bookmark") {
      message = "Favoritos persistentes serão conectados ao armazenamento do projeto; nada foi salvo ainda.";
      render();
    }
  };

  const onKeyDown = (event) => {
    const searchInput = event.target.closest("[data-browser-tab-search]");
    if (searchInput && root.contains(searchInput) && event.key === "Escape" && tabQuery) {
      event.preventDefault();
      tabQuery = "";
      searchInput.value = "";
      const slot = findSlot();
      if (slot) syncTabs(slot);
      return;
    }

    const tabButton = event.target.closest('[role="tab"][data-browser-tab-id]');
    if (!tabButton || !root.contains(tabButton)) return;
    const slot = findSlot();
    if (!slot?.contains(tabButton)) return;

    const tabs = visibleTabs();
    const index = tabs.findIndex((tab) => tab.id === tabButton.dataset.browserTabId);
    if (index < 0 || tabs.length === 0) return;

    let targetIndex = null;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      targetIndex = (index + 1) % tabs.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = tabs.length - 1;
    }
    if (targetIndex === null) return;

    event.preventDefault();
    const nextId = tabs[targetIndex].id;
    port.activateTab(nextId);
    focusTab(nextId);
  };

  const onInput = (event) => {
    const note = event.target.closest("[data-browser-reference-note]");
    if (note && root.contains(note)) {
      const slot = findSlot();
      if (slot?.contains(note)) {
        syncNoteDraft();
        noteDraftValue = note.value;
        return;
      }
    }

    const searchInput = event.target.closest("[data-browser-tab-search]");
    if (!searchInput || !root.contains(searchInput)) return;
    const slot = findSlot();
    if (!slot?.contains(searchInput)) return;
    tabQuery = searchInput.value;
    syncTabs(slot);
  };

  const onSubmit = (event) => {
    const form = event.target.closest("[data-browser-address-form]");
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const input = form.querySelector("[data-browser-address]");
    const tab = activeTab();
    if (!input || !tab) return;
    try {
      const url = normalizedAddress(input.value);
      if (!url) return;
      message = "";
      port.navigate(tab.id, url);
    } catch (error) {
      message = error instanceof Error ? error.message : "Endereço inválido.";
      render();
    }
  };

  const unsubscribeSession = port.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    render();
    if (pendingTabFocusId && snapshot.tabs.some((tab) => tab.id === pendingTabFocusId)) {
      focusTab(pendingTabFocusId);
      pendingTabFocusId = null;
    }
  });
  const unsubscribeProjects = projectPort?.subscribe((nextSnapshot) => {
    projectSnapshot = nextSnapshot;
    if (selectedProjectId && !nextSnapshot.projects.some((project) => project.id === selectedProjectId)) {
      selectedProjectId = null;
    }
    render();
  }) ?? (() => {});
  const unsubscribeReferences = referencePort?.subscribe((nextSnapshot) => {
    referenceSnapshot = nextSnapshot;
    const saved = activeSavedReference();
    if (saved && currentReferenceKey() !== noteDraftKey) {
      noteDraftKey = currentReferenceKey();
      noteDraftValue = saved.note;
    }
    render();
  }) ?? (() => {});
  const unsubscribeSurface = lifecycle.subscribeRender(render);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);
  windowObject.addEventListener("resize", syncViewport);
  windowObject.addEventListener("scroll", syncViewport, true);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      unsubscribeSession();
      unsubscribeProjects();
      unsubscribeReferences();
      unsubscribeSurface();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("input", onInput);
      root.removeEventListener("submit", onSubmit);
      windowObject.removeEventListener("resize", syncViewport);
      windowObject.removeEventListener("scroll", syncViewport, true);
      port.setViewport({ visible: false, x: 0, y: 0, width: 0, height: 0 });
    },
  });
}
