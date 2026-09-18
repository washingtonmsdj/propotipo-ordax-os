import { listFirstPartyApps, getFirstPartyApp, isAppAvailable } from "../../apps/catalog.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../../contracts/preference-runtime.mjs";
import { assertPreferenceStore, validatePreferenceRecord } from "../../contracts/preference-store.mjs";
import { assertSurfaceHost } from "../../contracts/surface-host.mjs";
import {
  MAX_WORKSPACE_AREAS,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";
import {
  ACCESSIBILITY_CONTRAST_PREFERENCE_ID,
  ACCESSIBILITY_MOTION_PREFERENCE_ID,
  ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID,
} from "../../services/preferences/accessibility.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../../services/preferences/appearance.mjs";
import { createDesktopShellMarkup, mountDesktopClock } from "./desktop-shell.mjs";
import { SURFACE_RENDER_LIFECYCLE_SCHEMA } from "./surface-lifecycle.mjs";
import {
  createSurfaceState,
  createWorkspaceSnapshot,
  getActiveArea,
  reduceSurfaceState,
} from "./surface-state.mjs";

const MOVABLE_WORKSPACE_MIN_WIDTH = 761;
const KEYBOARD_MOVE_STEP = 24;
const WORKSPACE_PERSIST_ACTIONS = new Set([
  "area.create",
  "area.switch",
  "app.launch",
  "window.focus",
  "window.move",
  "window.minimize",
  "window.maximize",
  "window.close",
  "workspace.show-desktop",
]);

const CONNECTIVITY_LABELS = {
  online: "Online",
  offline: "Offline",
  unknown: "Conectividade desconhecida",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function areaLabel(area) {
  return `Área ${String(area.ordinal).padStart(2, "0")}`;
}

function capabilityState(capabilityIds, capabilityId) {
  return capabilityIds.includes(capabilityId) ? "Disponível" : "Indisponível neste host";
}

function panelKey(panel, index) {
  if (panel.kind === "extension") return `extension:${panel.extensionId}`;
  if (panel.kind === "preference-choice") return `preference:${panel.preferenceId}`;
  if (panel.kind === "capability") return `capability:${panel.capabilityId}`;
  return `${panel.kind}:${index}`;
}

function createPreferenceChoice(panel, state) {
  const choices = element("div", "ordax-preference-choices");
  choices.dataset.preferenceChoices = panel.preferenceId;
  syncPreferenceChoice(choices, panel, state);
  return choices;
}

function syncPreferenceChoice(choices, panel, state) {
  const selected = state.preferences[panel.preferenceId];
  const existing = new Map(
    Array.from(choices.children)
      .filter((child) => child.dataset?.preferenceValue !== undefined)
      .map((child) => [child.dataset.preferenceValue, child]),
  );
  const retained = new Set();

  for (const option of panel.options) {
    let button = existing.get(option.value) ?? null;
    if (!button) {
      button = element("button", "ordax-preference-choice");
      button.type = "button";
    }
    button.textContent = option.label;
    button.dataset.preferenceId = panel.preferenceId;
    button.dataset.preferenceValue = option.value;
    button.dataset.selected = String(selected === option.value);
    button.setAttribute("aria-pressed", String(selected === option.value));
    choices.append(button);
    retained.add(button);
  }

  for (const child of Array.from(choices.children)) {
    if (!retained.has(child)) child.remove();
  }
}

function renderCapabilitiesPanel(section, state) {
  section.querySelector("[data-surface-capabilities]")?.remove();
  let content;
  if (state.capabilityIds.length === 0) {
    content = element("p", "ordax-empty", "Nenhuma capacidade adicional foi declarada.");
  } else {
    content = element("ul", "ordax-capability-list");
    for (const capabilityId of state.capabilityIds) {
      content.append(element("li", "", capabilityId));
    }
  }
  content.dataset.surfaceCapabilities = "";
  const body = section.querySelector(".ordax-app-panel-body");
  if (body) section.insertBefore(content, body);
  else section.append(content);
}

function renderPanel(panel, state, index) {
  const section = element(
    "section",
    panel.kind === "extension" ? "ordax-app-extension" : "ordax-app-panel",
  );
  section.dataset.surfacePanelKey = panelKey(panel, index);
  section.dataset.surfacePanelKind = panel.kind;
  section.append(element("span", "ordax-app-panel-label", panel.label));
  section.append(element("h3", "ordax-app-panel-title", panel.title));

  if (panel.kind === "extension") {
    section.dataset.appExtension = panel.extensionId;
    section.setAttribute("aria-label", panel.title);
  } else if (panel.kind === "connectivity") {
    const label = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    const badge = element("span", "ordax-inline-status", label);
    badge.dataset.state = state.connectivity;
    section.append(badge);
  } else if (panel.kind === "capability") {
    const available = state.capabilityIds.includes(panel.capabilityId);
    const badge = element("span", "ordax-inline-status", capabilityState(state.capabilityIds, panel.capabilityId));
    badge.dataset.state = available ? "available" : "unavailable";
    section.append(badge);
  } else if (panel.kind === "capabilities") {
    renderCapabilitiesPanel(section, state);
  } else if (panel.kind === "preference-choice") {
    section.append(createPreferenceChoice(panel, state));
  }

  if (panel.body) section.append(element("p", "ordax-app-panel-body", panel.body));
  return section;
}

function syncPanel(section, panel, state) {
  section.dataset.surfacePanelKind = panel.kind;
  if (panel.kind === "extension") {
    section.dataset.appExtension = panel.extensionId;
    section.setAttribute("aria-label", panel.title);
    return;
  }

  const label = section.querySelector(".ordax-app-panel-label");
  const title = section.querySelector(".ordax-app-panel-title");
  if (label) label.textContent = panel.label;
  if (title) title.textContent = panel.title;

  if (panel.kind === "connectivity") {
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      badge.textContent = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
      badge.dataset.state = state.connectivity;
    }
  } else if (panel.kind === "capability") {
    const available = state.capabilityIds.includes(panel.capabilityId);
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      badge.textContent = capabilityState(state.capabilityIds, panel.capabilityId);
      badge.dataset.state = available ? "available" : "unavailable";
    }
  } else if (panel.kind === "capabilities") {
    renderCapabilitiesPanel(section, state);
  } else if (panel.kind === "preference-choice") {
    const choices = section.querySelector(".ordax-preference-choices");
    if (choices) syncPreferenceChoice(choices, panel, state);
  }

  const body = section.querySelector(".ordax-app-panel-body");
  if (body && panel.body) body.textContent = panel.body;
}

function syncWindowPanels(body, app, state) {
  const existing = new Map(
    Array.from(body.children)
      .filter((child) => child.dataset?.surfacePanelKey)
      .map((child) => [child.dataset.surfacePanelKey, child]),
  );
  const retained = new Set();

  for (const [index, panel] of app.panels.entries()) {
    const key = panelKey(panel, index);
    let section = existing.get(key) ?? null;
    if (!section || section.dataset.surfacePanelKind !== panel.kind) {
      section?.remove();
      section = renderPanel(panel, state, index);
    } else {
      syncPanel(section, panel, state);
    }
    body.append(section);
    retained.add(section);
  }

  for (const child of Array.from(body.children)) {
    if (!retained.has(child)) child.remove();
  }
}

function syncWindowNode(windowNode, app, windowState, state, index, area) {
  windowNode.dataset.windowId = windowState.id;
  windowNode.dataset.appId = app.id;
  windowNode.dataset.areaId = area.id;
  windowNode.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
  windowNode.dataset.maximized = String(windowState.maximized);
  windowNode.dataset.minimized = String(windowState.minimized);
  windowNode.hidden = windowState.minimized;
  delete windowNode.dataset.dragging;

  const placementOrdinal = windowState.placementOrdinal ?? index + 1;
  windowNode.style.setProperty("--ordax-window-offset", `${((placementOrdinal - 1) % 5) * 18}px`);
  if (
    !windowState.maximized &&
    Number.isFinite(windowState.positionX) &&
    Number.isFinite(windowState.positionY)
  ) {
    windowNode.style.left = `${windowState.positionX}px`;
    windowNode.style.top = `${windowState.positionY}px`;
    windowNode.style.transform = "none";
    windowNode.dataset.positioned = "true";
  } else {
    windowNode.style.removeProperty("left");
    windowNode.style.removeProperty("top");
    windowNode.style.removeProperty("transform");
    delete windowNode.dataset.positioned;
  }

  windowNode.setAttribute("role", "region");
  windowNode.setAttribute("aria-label", app.title);
  const titlebar = windowNode.querySelector("[data-window-titlebar]");
  titlebar?.setAttribute(
    "aria-label",
    `Mover ${app.title}. Use Alt mais setas ou arraste quando houver espaço.`,
  );

  for (const control of windowNode.querySelectorAll("[data-window-action]")) {
    control.dataset.windowId = windowState.id;
    const action = control.dataset.windowAction;
    if (action === "minimize") control.setAttribute("aria-label", `Minimizar ${app.title}`);
    if (action === "maximize") {
      control.setAttribute(
        "aria-label",
        windowState.maximized ? `Restaurar ${app.title}` : `Maximizar ${app.title}`,
      );
    }
    if (action === "close") control.setAttribute("aria-label", `Fechar ${app.title}`);
  }

  const body = windowNode.querySelector(".ordax-window-body");
  if (body) syncWindowPanels(body, app, state);
}

function createWindow(app, windowState, state, index, area) {
  const windowNode = element("article", "ordax-window");
  const titlebar = element("header", "ordax-window-titlebar");
  titlebar.dataset.windowTitlebar = "";
  titlebar.tabIndex = 0;

  const identity = element("div", "ordax-window-identity");
  identity.append(element("span", "ordax-app-mark", app.monogram));
  const titleGroup = element("div", "ordax-window-title-group");
  titleGroup.append(element("strong", "", app.title));
  titleGroup.append(element("small", "", app.description));
  identity.append(titleGroup);

  const controls = element("div", "ordax-window-controls");
  for (const [action, glyph] of [
    ["minimize", "−"],
    ["maximize", "□"],
    ["close", "×"],
  ]) {
    const button = element("button", `ordax-window-control ordax-window-${action}`, glyph);
    button.type = "button";
    button.dataset.windowAction = action;
    controls.append(button);
  }
  titlebar.append(identity, controls);

  const body = element("div", "ordax-window-body");
  windowNode.append(titlebar, body);
  syncWindowNode(windowNode, app, windowState, state, index, area);
  return windowNode;
}

export function mountSurface(
  root,
  host,
  preferenceStore = null,
  workspaceStore = null,
  appActivation = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Surface root must be a DOM Element");
  }
  assertSurfaceHost(host);
  const store = preferenceStore === null ? null : assertPreferenceStore(preferenceStore);
  const workspacePort = workspaceStore === null ? null : assertWorkspaceStore(workspaceStore);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const documentElement = root.ownerDocument.documentElement;
  const preferenceSeed = store ? validatePreferenceRecord(store.load()) : {};
  const workspaceSeed = workspacePort ? validateWorkspaceRecord(workspacePort.load()) : null;
  let dragSession = null;
  const renderListeners = new Set();
  const preferenceListeners = new Set();

  root.innerHTML = createDesktopShellMarkup();
  const desktopClock = mountDesktopClock(root);
  let state = createSurfaceState(host.getSnapshot(), preferenceSeed, workspaceSeed);

  const workspace = root.querySelector("[data-workspace]");
  const launcher = root.querySelector("[data-launcher]");
  const launcherToggle = root.querySelector("[data-launcher-toggle]");
  const launcherQuery = root.querySelector("[data-launcher-query]");
  const appLauncher = root.querySelector("[data-app-launcher]");
  const windowLayer = root.querySelector("[data-window-layer]");
  const runningApps = root.querySelector("[data-running-apps]");
  const areaSwitcher = root.querySelector("[data-area-switcher]");
  const areaKicker = root.querySelector("[data-area-kicker]");

  const findRenderedWindow = (windowId) => {
    const areaId = getActiveArea(state).id;
    return Array.from(windowLayer.children).find(
      (node) => node.dataset.areaId === areaId && node.dataset.windowId === windowId,
    ) ?? null;
  };

  const isMovableWorkspace = () =>
    windowLayer.getBoundingClientRect().width >= MOVABLE_WORKSPACE_MIN_WIDTH;

  const clampPosition = (x, y, width, height) => {
    const layerRect = windowLayer.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, layerRect.width - width))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, layerRect.height - height))),
    };
  };

  const renderedGeometry = (windowNode) => {
    const layerRect = windowLayer.getBoundingClientRect();
    const windowRect = windowNode.getBoundingClientRect();
    return {
      x: windowRect.left - layerRect.left,
      y: windowRect.top - layerRect.top,
      width: windowRect.width,
      height: windowRect.height,
    };
  };

  const renderLauncher = () => {
    const query = launcherQuery.value.trim().toLocaleLowerCase("pt-BR");
    const retained = new Set();
    let visible = 0;

    for (const app of listFirstPartyApps()) {
      const available = isAppAvailable(app, state.capabilityIds);
      const searchable = `${app.title} ${app.description} ${app.id}`.toLocaleLowerCase("pt-BR");
      const matches = !query || searchable.includes(query);
      let button = Array.from(appLauncher.children).find(
        (child) => child.dataset?.launchApp === app.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-launcher-app");
        button.type = "button";
        button.dataset.launchApp = app.id;
        button.append(element("span", "ordax-app-mark", app.monogram));
        const copy = element("span", "ordax-launcher-app-copy");
        copy.append(element("strong"));
        copy.append(element("small"));
        button.append(copy);
      }

      button.hidden = !matches;
      button.disabled = !available;
      button.setAttribute("aria-label", available ? `Abrir ${app.title}` : `${app.title} indisponível`);
      const copy = button.querySelector(".ordax-launcher-app-copy");
      if (copy) {
        const title = copy.querySelector("strong");
        const description = copy.querySelector("small");
        if (title) title.textContent = app.title;
        if (description) {
          description.textContent = available ? app.description : "Capacidades necessárias indisponíveis";
        }
      }
      appLauncher.append(button);
      retained.add(button);
      if (matches) visible += 1;
    }

    for (const child of Array.from(appLauncher.children)) {
      if (child.dataset?.launchApp && !retained.has(child)) child.remove();
    }

    let empty = appLauncher.querySelector("[data-launcher-empty]");
    if (visible === 0) {
      if (!empty) {
        empty = element("p", "ordax-launcher-empty", "Nenhum aplicativo encontrado.");
        empty.dataset.launcherEmpty = "";
      }
      appLauncher.append(empty);
    } else {
      empty?.remove();
    }

    const activeElement = root.ownerDocument.activeElement;
    if (activeElement?.dataset?.launchApp && activeElement.hidden) {
      launcherQuery.focus({ preventScroll: true });
    }
  };

  const renderWindows = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    let visibleIndex = 0;

    for (const windowState of area.windows) {
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      const index = visibleIndex;
      if (!windowState.minimized) visibleIndex += 1;

      let windowNode = Array.from(windowLayer.children).find(
        (node) =>
          node.dataset.areaId === area.id
          && node.dataset.windowId === windowState.id
          && node.dataset.appId === app.id,
      ) ?? null;
      if (!windowNode) {
        windowNode = createWindow(app, windowState, state, index, area);
      } else {
        syncWindowNode(windowNode, app, windowState, state, index, area);
      }
      windowLayer.append(windowNode);
      retained.add(windowNode);
    }

    for (const staleWindow of Array.from(windowLayer.children)) {
      if (!retained.has(staleWindow)) staleWindow.remove();
    }
  };

  const renderDock = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    for (const windowState of area.windows) {
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      let button = Array.from(runningApps.children).find(
        (child) => child.dataset?.openWindow === windowState.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-running-app");
        button.type = "button";
        button.dataset.openWindow = windowState.id;
      }
      button.textContent = app.monogram;
      button.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
      button.setAttribute("aria-label", `${windowState.minimized ? "Restaurar" : "Focar"} ${app.title}`);
      button.title = app.title;
      runningApps.append(button);
      retained.add(button);
    }
    for (const child of Array.from(runningApps.children)) {
      if (child.dataset?.openWindow && !retained.has(child)) child.remove();
    }
  };

  const renderSidebar = () => {
    const area = getActiveArea(state);
    const activeWindow = area.windows.find((item) => item.id === area.activeWindowId) ?? null;
    for (const button of root.querySelectorAll("[data-sidebar-app]")) {
      const appId = button.dataset.sidebarApp;
      const app = getFirstPartyApp(appId);
      button.disabled = !isAppAvailable(app, state.capabilityIds);
      button.dataset.active = String(activeWindow?.appId === appId);
    }
  };

  const renderAreas = () => {
    const activeArea = getActiveArea(state);
    const retained = new Set();
    for (const area of state.areas) {
      const active = area.id === state.activeAreaId;
      let button = Array.from(areaSwitcher.children).find(
        (child) => child.dataset?.areaId === area.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-area-button");
        button.type = "button";
        button.dataset.areaId = area.id;
      }
      button.textContent = areaLabel(area);
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.setAttribute("aria-label", `Mudar para ${areaLabel(area)}`);
      if (active) {
        const dot = element("span", "ordax-area-dot");
        dot.setAttribute("aria-hidden", "true");
        button.prepend(dot);
      }
      areaSwitcher.append(button);
      retained.add(button);
    }

    let add = areaSwitcher.querySelector("[data-area-create]");
    if (state.areas.length < MAX_WORKSPACE_AREAS) {
      if (!add) {
        add = element("button", "ordax-area-button ordax-area-add", "+");
        add.type = "button";
        add.dataset.areaCreate = "";
        add.setAttribute("aria-label", "Criar nova área de trabalho");
      }
      areaSwitcher.append(add);
      retained.add(add);
    } else {
      add?.remove();
    }

    for (const child of Array.from(areaSwitcher.children)) {
      if (!retained.has(child)) child.remove();
    }
    areaKicker.textContent = areaLabel(activeArea);
  };

  const render = () => {
    root.dataset.ordaxTheme = state.preferences[APPEARANCE_PREFERENCE_ID];
    root.dataset.ordaxContrast = state.preferences[ACCESSIBILITY_CONTRAST_PREFERENCE_ID];
    root.dataset.ordaxMotion = state.preferences[ACCESSIBILITY_MOTION_PREFERENCE_ID];
    documentElement.dataset.ordaxTextScale =
      state.preferences[ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID];
    launcher.hidden = !state.launcherOpen;
    launcherToggle.setAttribute("aria-expanded", String(state.launcherOpen));

    const connectivityLabel = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    const connectivityTray = root.querySelector("[data-connectivity-tray]");
    if (connectivityTray.dataset.networkDetailOwner !== "true") {
      root.querySelector("[data-connectivity-label]").textContent = connectivityLabel;
      const connectivityIcon = root.querySelector("[data-connectivity-icon]");
      connectivityIcon.dataset.state = state.connectivity;
      connectivityIcon.dataset.networkKind = "unknown";
      connectivityIcon.dataset.signalLevel = "0";
      connectivityTray.title = `Rede: ${connectivityLabel}`;
    }

    for (const targetButton of root.querySelectorAll("[data-requires-capability]")) {
      const capabilityId = targetButton.dataset.requiresCapability;
      const available = state.capabilityIds.includes(capabilityId);
      targetButton.disabled = !available;
      targetButton.setAttribute("aria-disabled", String(!available));
      targetButton.title = available ? "" : "Este destino requer o espaço local do usuário.";
    }

    renderLauncher();
    renderWindows();
    renderDock();
    renderSidebar();
    renderAreas();
    for (const listener of [...renderListeners]) listener();
  };

  const dispatch = (action) => {
    const previousPreferences = state.preferences;
    const next = reduceSurfaceState(state, action);
    if (next === state) return;
    state = next;
    const preferencesChanged = state.preferences !== previousPreferences;
    if (preferencesChanged && store) {
      store.save(state.preferences);
    }
    if (workspacePort && WORKSPACE_PERSIST_ACTIONS.has(action?.type)) {
      workspacePort.save(createWorkspaceSnapshot(state));
    }
    render();
    if (preferencesChanged) {
      for (const listener of [...preferenceListeners]) listener(state.preferences);
    }
  };

  const openLauncher = () => {
    if (!state.launcherOpen) dispatch({ type: "launcher.toggle" });
    queueMicrotask(() => {
      launcherQuery.focus();
      launcherQuery.select();
    });
  };

  const onClick = (event) => {
    const areaButton = event.target.closest("[data-area-id]");
    if (areaButton) {
      dispatch({ type: "area.switch", areaId: areaButton.dataset.areaId });
      workspace.focus({ preventScroll: true });
      return;
    }

    const areaCreate = event.target.closest("[data-area-create]");
    if (areaCreate) {
      dispatch({ type: "area.create" });
      workspace.focus({ preventScroll: true });
      return;
    }

    const launcherButton = event.target.closest("[data-launcher-toggle]");
    if (launcherButton) {
      if (state.launcherOpen) {
        dispatch({ type: "launcher.close" });
      } else {
        openLauncher();
      }
      return;
    }

    const appButton = event.target.closest("[data-launch-app]");
    if (appButton) {
      const appId = appButton.dataset.launchApp;
      const requiredCapability = appButton.dataset.requiresCapability;
      const app = getFirstPartyApp(appId);
      if (
        (requiredCapability && !state.capabilityIds.includes(requiredCapability)) ||
        !isAppAvailable(app, state.capabilityIds)
      ) {
        return;
      }
      const target = appButton.dataset.appTarget;
      if (target && activationPort) {
        activationPort.publish({ appId, target });
      } else {
        dispatch({ type: "app.launch", appId });
      }
      launcherQuery.value = "";
      return;
    }

    const preferenceButton = event.target.closest("[data-preference-id]");
    if (preferenceButton) {
      dispatch({
        type: "preference.set",
        preferenceId: preferenceButton.dataset.preferenceId,
        value: preferenceButton.dataset.preferenceValue,
      });
      return;
    }

    const showDesktop = event.target.closest("[data-show-desktop]");
    if (showDesktop) {
      dispatch({ type: "workspace.show-desktop" });
      workspace.focus({ preventScroll: true });
      return;
    }

    const runningButton = event.target.closest("[data-open-window]");
    if (runningButton) {
      dispatch({ type: "window.focus", windowId: runningButton.dataset.openWindow });
      return;
    }

    const control = event.target.closest("[data-window-action]");
    if (control) {
      dispatch({ type: `window.${control.dataset.windowAction}`, windowId: control.dataset.windowId });
      return;
    }

    const windowNode = event.target.closest("[data-window-id]");
    if (windowNode) {
      dispatch({ type: "window.focus", windowId: windowNode.dataset.windowId });
      return;
    }

    if (state.launcherOpen && !event.target.closest("[data-launcher]")) {
      dispatch({ type: "launcher.close" });
    }
  };

  const onInput = (event) => {
    if (event.target === launcherQuery) renderLauncher();
  };

  // The embedded browser is an implementation detail of the native Surface.
  // Do not leak its vendor context menu (and untranslated browser actions) into
  // the OrdaX product. A future OrdaX-owned context menu can replace this with
  // localized actions once those actions have product semantics.
  const onContextMenu = (event) => {
    event.preventDefault();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !isMovableWorkspace()) return;
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!titlebar || !windowNode || event.target.closest("[data-window-action]")) return;
    const area = getActiveArea(state);
    const windowState = area.windows.find((item) => item.id === windowNode.dataset.windowId);
    if (!windowState || windowState.maximized) return;

    const geometry = renderedGeometry(windowNode);
    dispatch({ type: "window.focus", windowId: windowState.id });
    const focusedNode = findRenderedWindow(windowState.id);
    const focusedTitlebar = focusedNode?.querySelector("[data-window-titlebar]");
    if (!focusedNode || !focusedTitlebar) return;

    focusedTitlebar.setPointerCapture?.(event.pointerId);
    dragSession = {
      pointerId: event.pointerId,
      windowId: windowState.id,
      node: focusedNode,
      titlebar: focusedTitlebar,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: geometry.x,
      startY: geometry.y,
      width: geometry.width,
      height: geometry.height,
      x: geometry.x,
      y: geometry.y,
      moved: false,
    };
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const deltaX = event.clientX - dragSession.startClientX;
    const deltaY = event.clientY - dragSession.startClientY;
    if (!dragSession.moved && Math.abs(deltaX) + Math.abs(deltaY) < 3) return;

    const position = clampPosition(
      dragSession.startX + deltaX,
      dragSession.startY + deltaY,
      dragSession.width,
      dragSession.height,
    );
    dragSession.moved = true;
    dragSession.x = position.x;
    dragSession.y = position.y;
    dragSession.node.dataset.dragging = "true";
    dragSession.node.style.left = `${position.x}px`;
    dragSession.node.style.top = `${position.y}px`;
    dragSession.node.style.transform = "none";
    event.preventDefault();
  };

  const finishPointerDrag = (event, commit) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const current = dragSession;
    dragSession = null;
    current.titlebar.releasePointerCapture?.(event.pointerId);
    if (current.moved && commit) {
      dispatch({ type: "window.move", windowId: current.windowId, x: current.x, y: current.y });
    } else if (current.moved) {
      render();
    }
  };

  const onPointerUp = (event) => finishPointerDrag(event, true);
  const onPointerCancel = (event) => finishPointerDrag(event, false);

  const onDoubleClick = (event) => {
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!windowNode || event.target.closest("[data-window-action]")) return;
    dispatch({ type: "window.maximize", windowId: windowNode.dataset.windowId });
  };

  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      openLauncher();
      return;
    }

    if (event.key === "Escape" && state.launcherOpen) {
      dispatch({ type: "launcher.close" });
      launcherToggle.focus();
      return;
    }

    if (event.target === launcherQuery && state.launcherOpen) {
      const firstApp = appLauncher.querySelector("button:not(:disabled):not([hidden])");
      if (event.key === "ArrowDown" && firstApp) {
        firstApp.focus();
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && firstApp) {
        firstApp.click();
        event.preventDefault();
        return;
      }
    }

    if (!event.altKey || !isMovableWorkspace()) return;
    const deltas = {
      ArrowLeft: [-KEYBOARD_MOVE_STEP, 0],
      ArrowRight: [KEYBOARD_MOVE_STEP, 0],
      ArrowUp: [0, -KEYBOARD_MOVE_STEP],
      ArrowDown: [0, KEYBOARD_MOVE_STEP],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!titlebar || !windowNode || event.target.closest("[data-window-action]")) return;
    const area = getActiveArea(state);
    const windowState = area.windows.find((item) => item.id === windowNode.dataset.windowId);
    if (!windowState || windowState.maximized) return;

    const geometry = renderedGeometry(windowNode);
    const position = clampPosition(
      geometry.x + delta[0],
      geometry.y + delta[1],
      geometry.width,
      geometry.height,
    );
    dispatch({ type: "window.move", windowId: windowState.id, x: position.x, y: position.y });
    event.preventDefault();
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    const app = getFirstPartyApp(activation.appId);
    if (!isAppAvailable(app, state.capabilityIds)) return;
    dispatch({
      type: "app.launch",
      appId: activation.appId,
      target: activation.target,
    });
  });
  const unsubscribeHost = host.subscribe((snapshot) => dispatch({ type: "host.snapshot", snapshot }));
  render();

  const preferences = Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return state.preferences;
    },
    set(preferenceId, value) {
      dispatch({ type: "preference.set", preferenceId, value });
      return state.preferences;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Preference runtime listener must be a function");
      }
      preferenceListeners.add(listener);
      listener(state.preferences);
      return () => preferenceListeners.delete(listener);
    },
  });

  return Object.freeze({
    schema: SURFACE_RENDER_LIFECYCLE_SCHEMA,
    preferences,
    getAppTarget(appId) {
      const area = getActiveArea(state);
      const windowState = area.windows.find((item) => item.appId === appId);
      return windowState?.target ?? null;
    },
    subscribeRender(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface render listener must be a function");
      }
      renderListeners.add(listener);
      listener();
      return () => renderListeners.delete(listener);
    },
    destroy() {
      if (workspacePort) workspacePort.save(createWorkspaceSnapshot(state));
      desktopClock.destroy();
      if (dragSession) {
        dragSession.titlebar.releasePointerCapture?.(dragSession.pointerId);
        dragSession = null;
      }
      unsubscribeHost?.();
      unsubscribeActivation?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("keydown", onKeyDown);
      preferenceListeners.clear();
      renderListeners.clear();
      delete root.dataset.ordaxTheme;
      delete root.dataset.ordaxContrast;
      delete root.dataset.ordaxMotion;
      delete documentElement.dataset.ordaxTextScale;
      root.replaceChildren();
    },
  });
}
