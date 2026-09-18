const PANEL_SELECTOR = "[data-quick-panel]";

export function mountSystemTrayQuickPanels(root) {
  if (!(root instanceof Element)) {
    throw new TypeError("System tray quick panels require a Surface root Element");
  }

  const panels = Array.from(root.querySelectorAll(PANEL_SELECTOR));
  const triggers = Array.from(root.querySelectorAll("[data-quick-panel-toggle]"));
  if (panels.length === 0 || triggers.length === 0) {
    throw new Error("System tray quick panels require triggers and panels");
  }

  let activeId = null;
  let restoreFocus = null;

  const panelFor = (id) =>
    panels.find((panel) => panel.dataset.quickPanel === id) ?? null;

  const triggerFor = (id) =>
    triggers.find((trigger) => trigger.dataset.quickPanelToggle === id) ?? null;

  const close = ({ restore = true } = {}) => {
    if (activeId === null) return;
    const previousId = activeId;
    activeId = null;
    const panel = panelFor(previousId);
    const trigger = triggerFor(previousId);
    if (panel) {
      panel.hidden = true;
      panel.dataset.open = "false";
    }
    trigger?.setAttribute("aria-expanded", "false");
    if (restore && restoreFocus instanceof HTMLElement) restoreFocus.focus();
    restoreFocus = null;
  };

  const open = (id, trigger) => {
    const panel = panelFor(id);
    if (!panel) return;
    if (activeId === id) {
      close();
      return;
    }
    close({ restore: false });
    activeId = id;
    restoreFocus = trigger instanceof HTMLElement ? trigger : null;
    panel.hidden = false;
    panel.dataset.open = "true";
    triggerFor(id)?.setAttribute("aria-expanded", "true");
    panel.dispatchEvent(new CustomEvent("ordax:quick-panel-open", { bubbles: false }));
    const focusTarget = panel.querySelector("[data-quick-panel-autofocus], button, input");
    focusTarget?.focus?.();
  };

  const onClick = (event) => {
    const trigger = event.target.closest("[data-quick-panel-toggle]");
    if (trigger && root.contains(trigger)) {
      event.preventDefault();
      event.stopPropagation();
      open(trigger.dataset.quickPanelToggle, trigger);
      return;
    }

    const closeButton = event.target.closest("[data-quick-panel-close]");
    if (closeButton && root.contains(closeButton)) {
      event.preventDefault();
      close();
      return;
    }

    if (
      activeId !== null
      && !event.target.closest(PANEL_SELECTOR)
      && !event.target.closest("[data-quick-panel-toggle]")
    ) {
      close({ restore: false });
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape" && activeId !== null) {
      event.preventDefault();
      close();
    }
  };

  root.addEventListener("click", onClick, true);
  root.addEventListener("keydown", onKeyDown);

  return Object.freeze({
    close,
    destroy() {
      close({ restore: false });
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("keydown", onKeyDown);
    },
  });
}
