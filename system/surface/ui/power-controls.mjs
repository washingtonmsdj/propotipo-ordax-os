import {
  assertPowerActionsPort,
  isPowerActionSupported,
  validatePowerActionsSnapshot,
} from "../../contracts/power-actions.mjs";

const ACTIONS = [
  {
    id: "restart",
    label: "Reiniciar",
    confirmingLabel: "Confirmar reinício",
    pendingLabel: "Reiniciando…",
    description: "Encerra esta execução e inicia o OrdaX novamente.",
    confirmation: "Clique novamente em Reiniciar para confirmar.",
    mark: "↻",
  },
  {
    id: "shutdown",
    label: "Desligar",
    confirmingLabel: "Confirmar desligamento",
    pendingLabel: "Desligando…",
    description: "Encerra esta execução e desliga o equipamento.",
    confirmation: "Clique novamente em Desligar para confirmar.",
    mark: "⏻",
  },
];

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountPowerControls(root, powerActions = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("Power controls root must be a DOM Element");
  }
  if (powerActions === null) {
    return Object.freeze({ destroy() {} });
  }

  const port = assertPowerActionsPort(powerActions);
  let snapshot = validatePowerActionsSnapshot(port.getSnapshot());
  const documentObject = root.ownerDocument;
  const shell = root.querySelector("[data-ordax-shell]");
  const slot = root.querySelector("[data-power-slot]");
  if (!shell || !slot) {
    throw new Error("Surface power controls require the shared shell power slot");
  }

  const availableActions = () => ACTIONS.filter((item) => isPowerActionSupported(snapshot, item.id));
  if (availableActions().length === 0) {
    return Object.freeze({ destroy() {} });
  }

  const toggle = node(documentObject, "button", "ordax-rail-button ordax-rail-power");
  toggle.type = "button";
  toggle.dataset.powerToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Abrir controles de energia");
  toggle.append(
    node(documentObject, "span", "ordax-rail-power-icon", "⏻"),
    node(documentObject, "span", "", "Desligar"),
  );
  slot.append(toggle);

  const overlay = node(documentObject, "div", "ordax-launcher ordax-power-menu");
  overlay.dataset.powerMenu = "";
  overlay.hidden = true;
  const panel = node(documentObject, "div", "ordax-launcher-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Controles de energia do OrdaX");
  const heading = node(documentObject, "div", "ordax-launcher-heading");
  heading.append(
    node(documentObject, "span", "", "Energia"),
    node(documentObject, "small", "", "Ação local do host"),
  );
  const grid = node(documentObject, "div", "ordax-launcher-grid");
  const status = node(documentObject, "p", "ordax-empty", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(heading, grid, status);
  overlay.append(panel);
  shell.append(overlay);

  let open = false;
  let confirming = null;
  let pending = null;
  let message = "";
  let resetTimer = null;
  let actionOrdinal = 0;
  let destroyed = false;

  const captureFocusedAction = () => {
    if (!open) return null;
    const activeElement = documentObject.activeElement;
    const button = activeElement?.closest?.("[data-power-action]");
    if (!button || !grid.contains(button)) return null;
    return button.dataset.powerAction ?? null;
  };

  const restoreFocusedAction = (actionId) => {
    if (!open || !actionId) return;
    const button = Array.from(grid.querySelectorAll("[data-power-action]"))
      .find((candidate) => candidate.dataset.powerAction === actionId) ?? null;
    if (button && !button.disabled) {
      button.focus({ preventScroll: true });
      return;
    }
    toggle.focus({ preventScroll: true });
  };

  const render = () => {
    const focusedAction = captureFocusedAction();
    overlay.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    grid.replaceChildren();
    for (const item of availableActions()) {
      const button = node(documentObject, "button", "ordax-launcher-app");
      button.type = "button";
      button.dataset.powerAction = item.id;
      button.disabled = pending !== null;
      const copy = node(documentObject, "span", "ordax-launcher-app-copy");
      const label = pending === item.id
        ? item.pendingLabel
        : confirming === item.id
          ? item.confirmingLabel
          : item.label;
      copy.append(
        node(documentObject, "strong", "", label),
        node(documentObject, "small", "", item.description),
      );
      button.append(node(documentObject, "span", "ordax-app-mark", item.mark), copy);
      grid.append(button);
    }
    status.textContent = message;
    status.hidden = message.length === 0;
    restoreFocusedAction(focusedAction);
  };

  const clearResetTimer = () => {
    if (resetTimer !== null) {
      globalThis.clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  const invoke = (action) => {
    if (destroyed || pending !== null || !isPowerActionSupported(snapshot, action)) return;
    const descriptor = ACTIONS.find((item) => item.id === action);
    if (!descriptor) return;

    if (confirming !== action) {
      confirming = action;
      message = descriptor.confirmation;
      render();
      return;
    }

    const ordinal = ++actionOrdinal;
    confirming = null;
    pending = action;
    message = action === "restart" ? "Solicitando reinício ao host…" : "Solicitando desligamento ao host…";
    render();
    Promise.resolve()
      .then(() => port.execute(action))
      .then(() => {
        if (destroyed || ordinal !== actionOrdinal) return;
        message = "Solicitação aceita pelo host.";
        render();
        clearResetTimer();
        resetTimer = globalThis.setTimeout(() => {
          if (destroyed || ordinal !== actionOrdinal) return;
          pending = null;
          message = "O host permaneceu ativo; a ação pode ser tentada novamente.";
          render();
        }, 5000);
      })
      .catch(() => {
        if (destroyed || ordinal !== actionOrdinal) return;
        pending = null;
        message = "A ação de energia não pôde ser concluída.";
        render();
      });
  };

  const onToggle = () => {
    if (pending !== null) return;
    open = !open;
    if (!open) {
      confirming = null;
      message = "";
    }
    render();
  };

  const onRootClick = (event) => {
    if (event.target.closest("[data-power-toggle]")) {
      onToggle();
      return;
    }
    const actionButton = event.target.closest("[data-power-action]");
    if (actionButton) {
      invoke(actionButton.dataset.powerAction);
      return;
    }
    if (open && !event.target.closest("[data-power-menu]")) {
      open = false;
      confirming = null;
      message = "";
      render();
    }
  };

  const onRootKeyDown = (event) => {
    if (event.key === "Escape" && open && pending === null) {
      open = false;
      confirming = null;
      message = "";
      render();
      toggle.focus();
    }
  };

  root.addEventListener("click", onRootClick);
  root.addEventListener("keydown", onRootKeyDown);
  const unsubscribe = port.subscribe((nextSnapshot) => {
    if (destroyed) return;
    snapshot = validatePowerActionsSnapshot(nextSnapshot);
    if (availableActions().length === 0) {
      open = false;
    }
    render();
  });
  render();

  return Object.freeze({
    destroy() {
      destroyed = true;
      actionOrdinal += 1;
      clearResetTimer();
      unsubscribe?.();
      root.removeEventListener("click", onRootClick);
      root.removeEventListener("keydown", onRootKeyDown);
      overlay.remove();
      toggle.remove();
    },
  });
}
