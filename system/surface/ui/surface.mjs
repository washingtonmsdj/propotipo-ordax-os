import { listFirstPartyApps, getFirstPartyApp, isAppAvailable } from "../../apps/catalog.mjs";
import {
  assertIdentityActionsPort,
  isIdentityActionSupported,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";
import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { assertPreferenceStore, validatePreferenceRecord } from "../../contracts/preference-store.mjs";
import { assertSurfaceHost } from "../../contracts/surface-host.mjs";
import { assertWorkspaceStore, validateWorkspaceRecord } from "../../contracts/workspace-store.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../../services/preferences/appearance.mjs";
import { createSurfaceState, createWorkspaceSnapshot, reduceSurfaceState } from "./surface-state.mjs";

const MOVABLE_WORKSPACE_MIN_WIDTH = 761;
const KEYBOARD_MOVE_STEP = 24;
const WORKSPACE_PERSIST_ACTIONS = new Set([
  "app.launch",
  "window.focus",
  "window.move",
  "window.minimize",
  "window.maximize",
  "window.close",
  "workspace.show-desktop",
]);

const SHELL_MARKUP = `
  <div class="ordax-shell" data-ordax-shell>
    <header class="ordax-topbar">
      <div class="ordax-brand" aria-label="OrdaX">
        <span class="ordax-brand-mark" aria-hidden="true">O</span>
        <span>OrdaX</span>
      </div>
      <div class="ordax-status" role="status" aria-live="polite">
        <span class="ordax-status-dot" data-connectivity-dot aria-hidden="true"></span>
        <span data-connectivity-label>Conectividade desconhecida</span>
      </div>
    </header>

    <main class="ordax-workspace" tabindex="-1" data-workspace>
      <section class="ordax-desktop" aria-labelledby="surface-home-title">
        <div class="ordax-desktop-intro">
          <p class="ordax-eyebrow">Surface compartilhada</p>
          <h1 id="surface-home-title">Seu espaço OrdaX.</h1>
          <p class="ordax-lead">
            Uma única Surface e um único modelo de aplicações para Web, Mobile, Desktop, USB e Native.
            O host expõe capacidades; os apps e o workspace continuam os mesmos.
          </p>
        </div>
        <div class="ordax-card-grid">
          <article class="ordax-card">
            <span class="ordax-card-label">Workspace</span>
            <strong data-window-count>0 apps abertos</strong>
            <p>Janelas pertencem à Surface compartilhada e não ao adapter de uma plataforma.</p>
          </article>
          <article class="ordax-card">
            <span class="ordax-card-label">Conectividade</span>
            <strong data-connectivity-card>Desconhecida</strong>
            <p>O estado vem do host por contrato e pode mudar sem recarregar a Surface.</p>
          </article>
          <article class="ordax-card">
            <span class="ordax-card-label">Capacidades disponíveis</span>
            <strong data-capability-count>0</strong>
            <p>A Surface reage a capacidades disponíveis, nunca ao nome da plataforma.</p>
          </article>
        </div>
      </section>
      <div class="ordax-window-layer" data-window-layer aria-live="polite"></div>
    </main>

    <div class="ordax-launcher" data-launcher hidden>
      <div class="ordax-launcher-panel" role="menu" aria-label="Aplicações OrdaX">
        <div class="ordax-launcher-heading">
          <span>Aplicações</span>
          <small>Fonte compartilhada</small>
        </div>
        <div class="ordax-launcher-grid" data-app-launcher></div>
      </div>
    </div>

    <nav class="ordax-dock" aria-label="Controles da Surface">
      <button type="button" class="ordax-dock-button ordax-primary" data-launcher-toggle aria-expanded="false" aria-label="Abrir lançador">
        <span aria-hidden="true">O</span>
      </button>
      <button type="button" class="ordax-dock-button" data-show-desktop aria-label="Mostrar área de trabalho">Mesa</button>
      <div class="ordax-dock-running" data-running-apps aria-label="Aplicações abertas"></div>
    </nav>
  </div>
`;

const CONNECTIVITY_LABELS = {
  online: "Online",
  offline: "Offline",
  unknown: "Conectividade desconhecida",
};

const IDENTITY_LABELS = {
  unavailable: "Identidade indisponível neste host",
  "signed-out": "Sem sessão ativa",
  "signed-in": "Sessão ativa",
};

const IDENTITY_ACTION_LABELS = {
  "sign-in": "Entrar",
  "sign-out": "Sair",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function desiredIdentityAction(identitySnapshot) {
  if (identitySnapshot.state === "signed-out") return "sign-in";
  if (identitySnapshot.state === "signed-in") return "sign-out";
  return null;
}

function renderIdentityActions(identitySnapshot, actionsSnapshot, pendingAction, actionMessage) {
  const container = element("div", "ordax-preference-choices");
  const action = desiredIdentityAction(identitySnapshot);

  if (!action || !isIdentityActionSupported(actionsSnapshot, action)) {
    const status = element(
      "span",
      "ordax-inline-status",
      identitySnapshot.state === "unavailable"
        ? "Ações de autenticação indisponíveis neste host"
        : "Nenhuma ação de autenticação disponível",
    );
    status.dataset.state = "unavailable";
    container.append(status);
  } else {
    const pending = pendingAction === action;
    const label = pending
      ? action === "sign-in" ? "Entrando…" : "Saindo…"
      : IDENTITY_ACTION_LABELS[action];
    const button = element("button", "ordax-preference-choice", label);
    button.type = "button";
    button.dataset.identityAction = action;
    button.disabled = pendingAction !== null;
    button.setAttribute("aria-busy", String(pending));
    container.append(button);
  }

  if (actionMessage) {
    container.append(element("span", "ordax-empty", actionMessage));
  }
  return container;
}

function renderPanel(
  panel,
  state,
  identitySnapshot,
  identityActionsSnapshot,
  identityActionPending,
  identityActionMessage,
) {
  const section = element("section", "ordax-app-panel");
  section.append(element("span", "ordax-app-panel-label", panel.label));
  section.append(element("h3", "ordax-app-panel-title", panel.title));

  if (panel.kind === "connectivity") {
    const label = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    const badge = element("span", "ordax-inline-status", label);
    badge.dataset.state = state.connectivity;
    section.append(badge);
  } else if (panel.kind === "identity-session") {
    const label = IDENTITY_LABELS[identitySnapshot.state] ?? IDENTITY_LABELS.unavailable;
    const badge = element("span", "ordax-inline-status", label);
    badge.dataset.state = identitySnapshot.state;
    section.append(badge);
    if (identitySnapshot.state === "signed-in") {
      section.append(element("p", "ordax-app-panel-body", identitySnapshot.displayName));
    }
  } else if (panel.kind === "identity-actions") {
    section.append(
      renderIdentityActions(
        identitySnapshot,
        identityActionsSnapshot,
        identityActionPending,
        identityActionMessage,
      ),
    );
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

function createWindow(
  app,
  windowState,
  state,
  identitySnapshot,
  identityActionsSnapshot,
  identityActionPending,
  identityActionMessage,
  index,
) {
  const windowNode = element("article", "ordax-window");
  windowNode.dataset.windowId = windowState.id;
  windowNode.dataset.active = String(state.activeWindowId === windowState.id);
  windowNode.dataset.maximized = String(windowState.maximized);
  const placementOrdinal = windowState.placementOrdinal ?? index + 1;
  windowNode.style.setProperty("--ordax-window-offset", `${((placementOrdinal - 1) % 8) * 22}px`);
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
    body.append(
      renderPanel(
        panel,
        state,
        identitySnapshot,
        identityActionsSnapshot,
        identityActionPending,
        identityActionMessage,
      ),
    );
  }
  windowNode.append(titlebar, body);
  return windowNode;
}

export function mountSurface(
  root,
  host,
  preferenceStore = null,
  identitySession = null,
  identityActions = null,
  workspaceStore = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Surface root must be a DOM Element");
  }
  assertSurfaceHost(host);
  const store = preferenceStore === null ? null : assertPreferenceStore(preferenceStore);
  const identityPort = identitySession === null ? null : assertIdentitySessionPort(identitySession);
  const identityActionsPort = identityActions === null ? null : assertIdentityActionsPort(identityActions);
  const workspacePort = workspaceStore === null ? null : assertWorkspaceStore(workspaceStore);
  const preferenceSeed = store ? validatePreferenceRecord(store.load()) : {};
  const workspaceSeed = workspacePort ? validateWorkspaceRecord(workspacePort.load()) : null;
  let identitySnapshot = validateIdentitySessionSnapshot(
    identityPort ? identityPort.getSnapshot() : { state: "unavailable" },
  );
  let identityActionsSnapshot = validateIdentityActionsSnapshot(
    identityActionsPort ? identityActionsPort.getSnapshot() : { supportedActions: [] },
  );
  let identityActionPending = null;
  let identityActionMessage = null;
  let dragSession = null;

  root.innerHTML = SHELL_MARKUP;
  let state = createSurfaceState(host.getSnapshot(), preferenceSeed, workspaceSeed);

  const workspace = root.querySelector("[data-workspace]");
  const launcher = root.querySelector("[data-launcher]");
  const launcherToggle = root.querySelector("[data-launcher-toggle]");
  const appLauncher = root.querySelector("[data-app-launcher]");
  const windowLayer = root.querySelector("[data-window-layer]");
  const runningApps = root.querySelector("[data-running-apps]");

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
    for (const app of listFirstPartyApps()) {
      const available = isAppAvailable(app, state.capabilityIds);
      const button = element("button", "ordax-launcher-app");
      button.type = "button";
      button.dataset.launchApp = app.id;
      button.disabled = !available;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", available ? `Abrir ${app.title}` : `${app.title} indisponível`);
      button.append(element("span", "ordax-app-mark", app.monogram));
      const copy = element("span", "ordax-launcher-app-copy");
      copy.append(element("strong", "", app.title));
      copy.append(element("small", "", available ? app.description : "Capacidades necessárias indisponíveis"));
      button.append(copy);
      appLauncher.append(button);
    }
  };

  const renderWindows = () => {
    windowLayer.replaceChildren();
    let visibleIndex = 0;
    for (const windowState of state.windows) {
      if (windowState.minimized) continue;
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      windowLayer.append(
        createWindow(
          app,
          windowState,
          state,
          identitySnapshot,
          identityActionsSnapshot,
          identityActionPending,
          identityActionMessage,
          visibleIndex,
        ),
      );
      visibleIndex += 1;
    }
  };

  const renderDock = () => {
    runningApps.replaceChildren();
    for (const windowState of state.windows) {
      const app = getFirstPartyApp(windowState.appId);
      if (!app) continue;
      const button = element("button", "ordax-dock-button ordax-running-app", app.monogram);
      button.type = "button";
      button.dataset.openWindow = windowState.id;
      button.dataset.active = String(state.activeWindowId === windowState.id && !windowState.minimized);
      button.setAttribute("aria-label", `${windowState.minimized ? "Restaurar" : "Focar"} ${app.title}`);
      button.title = app.title;
      runningApps.append(button);
    }
  };

  const render = () => {
    root.dataset.ordaxTheme = state.preferences[APPEARANCE_PREFERENCE_ID];
    launcher.hidden = !state.launcherOpen;
    launcherToggle.setAttribute("aria-expanded", String(state.launcherOpen));

    const connectivityLabel = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    root.querySelector("[data-connectivity-label]").textContent = connectivityLabel;
    root.querySelector("[data-connectivity-card]").textContent = connectivityLabel;
    root.querySelector("[data-connectivity-dot]").dataset.state = state.connectivity;
    root.querySelector("[data-capability-count]").textContent = String(state.capabilityIds.length);
    root.querySelector("[data-window-count]").textContent = `${state.windows.length} ${state.windows.length === 1 ? "app aberto" : "apps abertos"}`;

    renderLauncher();
    renderWindows();
    renderDock();
  };

  const dispatch = (action) => {
    const next = reduceSurfaceState(state, action);
    if (next === state) return;
    state = next;
    if (action?.type === "preference.set" && store) {
      store.save(state.preferences);
    }
    if (workspacePort && WORKSPACE_PERSIST_ACTIONS.has(action?.type)) {
      workspacePort.save(createWorkspaceSnapshot(state));
    }
    render();
  };

  const invokeIdentityAction = (action) => {
    if (
      !identityActionsPort ||
      identityActionPending !== null ||
      !isIdentityActionSupported(identityActionsSnapshot, action)
    ) {
      return;
    }

    identityActionPending = action;
    identityActionMessage = null;
    render();
    Promise.resolve()
      .then(() => identityActionsPort.execute(action))
      .then(() => {
        identityActionPending = null;
        render();
      })
      .catch(() => {
        identityActionPending = null;
        identityActionMessage = "A ação de conta não pôde ser concluída.";
        render();
      });
  };

  const onClick = (event) => {
    const launcherButton = event.target.closest("[data-launcher-toggle]");
    if (launcherButton) {
      dispatch({ type: "launcher.toggle" });
      return;
    }

    const appButton = event.target.closest("[data-launch-app]");
    if (appButton) {
      dispatch({ type: "app.launch", appId: appButton.dataset.launchApp });
      return;
    }

    const identityActionButton = event.target.closest("[data-identity-action]");
    if (identityActionButton) {
      invokeIdentityAction(identityActionButton.dataset.identityAction);
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

  const onPointerDown = (event) => {
    if (event.button !== 0 || !isMovableWorkspace()) return;
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!titlebar || !windowNode || event.target.closest("[data-window-action]")) return;
    const windowState = state.windows.find((item) => item.id === windowNode.dataset.windowId);
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
    if (event.key === "Escape" && state.launcherOpen) {
      dispatch({ type: "launcher.close" });
      launcherToggle.focus();
      return;
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
    const windowState = state.windows.find((item) => item.id === windowNode.dataset.windowId);
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
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeHost = host.subscribe((snapshot) => dispatch({ type: "host.snapshot", snapshot }));
  const unsubscribeIdentity = identityPort?.subscribe((snapshot) => {
    identitySnapshot = validateIdentitySessionSnapshot(snapshot);
    identityActionMessage = null;
    render();
  });
  const unsubscribeIdentityActions = identityActionsPort?.subscribe((snapshot) => {
    identityActionsSnapshot = validateIdentityActionsSnapshot(snapshot);
    identityActionMessage = null;
    render();
  });
  render();

  return Object.freeze({
    destroy() {
      if (workspacePort) workspacePort.save(createWorkspaceSnapshot(state));
      if (dragSession) {
        dragSession.titlebar.releasePointerCapture?.(dragSession.pointerId);
        dragSession = null;
      }
      unsubscribeHost?.();
      unsubscribeIdentity?.();
      unsubscribeIdentityActions?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("keydown", onKeyDown);
      delete root.dataset.ordaxTheme;
      root.replaceChildren();
    },
  });
}
