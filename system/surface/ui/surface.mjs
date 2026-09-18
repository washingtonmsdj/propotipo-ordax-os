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

function renderPreferenceChoice(panel, state) {
  const choices = element("div", "ordax-preference-choices");
  const selected = state.preferences[panel.preferenceId];
  for (const option of panel.options) {
    const button = element("button", "ordax-preference-choice", option.label);
    button.type = "button";
    button.dataset.preferenceId = panel.preferenceId;
    button.dataset.preferenceValue = option.value;
    button.dataset.selected = String(selected === option.value);
    button.setAttribute("aria-pressed", String(selected === option.value));
    choices.append(button);
  }
  return choices;
}

function renderPanel(panel, state) {
  const section = element(
    "section",
    panel.kind === "extension" ? "ordax-app-extension" : "ordax-app-panel",
  );
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
    if (state.capabilityIds.length === 0) {
      section.append(element("p", "ordax-empty", "Nenhuma capacidade adicional foi declarada."));
    } else {
      const list = element("ul", "ordax-capability-list");
      for (const capabilityId of state.capabilityIds) {
        list.append(element("li", "", capabilityId));
      }
      section.append(list);
    }
  } else if (panel.kind === "preference-choice") {
    section.append(renderPreferenceChoice(panel, state));
  }

  if (panel.body) section.append(element("p", "ordax-app-panel-body", panel.body));
  return section;
}

function createWindow(app, windowState, state, index) {
  const activeArea = getActiveArea(state);
  const windowNode = element("article", "ordax-window");
  windowNode.dataset.windowId = windowState.id;
  windowNode.dataset.active = String(activeArea.activeWindowId === windowState.id);
  windowNode.dataset.maximized = String(windowState.maximized);
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
  }
  windowNode.setAttribute("role", "region");
  windowNode.setAttribute("aria-label", app.title);

  const titlebar = element("header", "ordax-window-titlebar");
  titlebar.dataset.windowTitlebar = "";
  titlebar.tabIndex = 0;
  titlebar.setAttribute(
    "aria-label",
    `Mover ${app.title}. Use Alt mais setas ou arraste quando houver espaço.`,
  );
  const identity = element("div", "ordax-window-identity");
  identity.append(element("span", "ordax-app-mark", app.monogram));
  const titleGroup = element("div", "ordax-window-title-group");
  titleGroup.append(element("strong", "", app.title));
  titleGroup.append(element("small", "", app.description));
  identity.append(titleGroup);

  const controls = element("div", "ordax-window-controls");
  for (const [action, label, glyph] of [
    ["minimize", `Minimizar ${app.title}`, "−"],
    ["maximize", windowState.maximized ? `Restaurar ${app.title}` : `Maximizar ${app.title}`, "□"],
    ["close", `Fechar ${app.title}`, "×"],
  ]) {
    const button = element("button", `ordax-window-control ordax-window-${action}`, glyph);
    button.type = "button";
    button.dataset.windowAction = action;
    button.dataset.windowId = windowState.id;
    button.setAttribute("aria-label", label);
    controls.append(button);
  }
  titlebar.append(identity, controls);

  const body = element("div", "ordax-window-body");
  for (const panel of app.panels) {
    body.append(renderPanel(panel, state));
  }
  windowNode.append(titlebar, body);
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

  const findRenderedWindow = (windowId) =>
    Array.from(windowLayer.children).find((node) => node.dataset.windowId === windowId) ?? null;

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
    appLauncher.replaceChildren();
    const query = launcherQuery.value.trim().toLocaleLowerCase("pt-BR");
    let visible = 0;
    for (const app of listFirstPartyApps()) {
      const available = isAppAvailable(app, state.capabilityIds);
      const searchable = `${app.title} ${app.description} ${app.id}`.toLocaleLowerCase("pt-BR");
      if (query && !searchable.includes(query)) continue;
      const button = element("button", "ordax-launcher-app");
      button.type = "button";
      button.dataset.launchApp = app.id;
      button.disabled = !available;
      button.setAttribute("aria-label", available ? `Abrir ${app.title}` : `${app.title} indisponível`);
      button.append(element("span", "ordax-app-mark", app.monogram));
      const copy = element("span", "ordax-launcher-app-copy");
      copy.append(element("strong", "", app.title));
      copy.append(element("small", "", available ? app.description : "Capacidades necessárias indisponíveis"));
      button.append(copy);
      appLauncher.append(button);
      visible += 1;
    }
    if (visible === 0) {
      appLauncher.append(element("p", "ordax-launcher-empty", "Nenhum aplicativo encontrado."));
    }
  };

  const renderWindows = () => {
    const area = getActiveArea(state);
    windowLayer.replaceChildren();
    let visibleIndex = 0;
    for (const windowState of area.windows) {
      if (windowState.minimized) continue;
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      windowLayer.append(
        createWindow(app, windowState, state, visibleIndex),
      );
      visibleIndex += 1;
    }
  };

  const renderDock = () => {
    const area = getActiveArea(state);
    runningApps.replaceChildren();
    for (const windowState of area.windows) {
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      const button = element("button", "ordax-running-app", app.monogram);
      button.type = "button";
      button.dataset.openWindow = windowState.id;
      button.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
      button.setAttribute("aria-label", `${windowState.minimized ? "Restaurar" : "Focar"} ${app.title}`);
      button.title = app.title;
      runningApps.append(button);
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
    areaSwitcher.replaceChildren();
    for (const area of state.areas) {
      const active = area.id === state.activeAreaId;
      const button = element("button", "ordax-area-button", areaLabel(area));
      button.type = "button";
      button.dataset.areaId = area.id;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.setAttribute("aria-label", `Mudar para ${areaLabel(area)}`);
      if (active) {
        button.prepend(element("span", "ordax-area-dot"));
        button.firstElementChild.setAttribute("aria-hidden", "true");
      }
      areaSwitcher.append(button);
    }
    if (state.areas.length < MAX_WORKSPACE_AREAS) {
      const add = element("button", "ordax-area-button ordax-area-add", "+");
      add.type = "button";
      add.dataset.areaCreate = "";
      add.setAttribute("aria-label", "Criar nova área de trabalho");
      areaSwitcher.append(add);
    }
    areaKicker.textContent = `${areaLabel(activeArea)} · Surface compartilhada • recuperação ao vivo · entrega 68`;
  };

  const render = () => {
    root.dataset.ordaxTheme = state.preferences[APPEARANCE_PREFERENCE_ID];
    launcher.hidden = !state.launcherOpen;
    launcherToggle.setAttribute("aria-expanded", String(state.launcherOpen));

    const connectivityLabel = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    root.querySelector("[data-connectivity-label]").textContent = connectivityLabel;
    root.querySelector("[data-connectivity-dot]").dataset.state = state.connectivity;

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
      dispatch({ type: "app.launch", appId });
      const target = appButton.dataset.appTarget;
      if (target && activationPort) {
        activationPort.publish({ appId, target });
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
      const firstApp = appLauncher.querySelector("button:not(:disabled)");
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
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("keydown", onKeyDown);
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
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("keydown", onKeyDown);
      preferenceListeners.clear();
      renderListeners.clear();
      delete root.dataset.ordaxTheme;
      root.replaceChildren();
    },
  });
}
