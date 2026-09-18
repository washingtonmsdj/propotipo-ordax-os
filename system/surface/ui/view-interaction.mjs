const VOLATILE_DATA_ATTRIBUTES = new Set([
  "data-active",
  "data-alerting",
  "data-connected",
  "data-selected",
  "data-state",
]);

function captureFocusIdentity(slot) {
  const active = slot.ownerDocument.activeElement;
  if (!(active instanceof Element) || !slot.contains(active)) return null;

  const dataAttributes = Array.from(active.attributes)
    .filter(
      (attribute) =>
        attribute.name.startsWith("data-")
        && !VOLATILE_DATA_ATTRIBUTES.has(attribute.name),
    )
    .map((attribute) => [attribute.name, attribute.value]);

  const ariaLabel = active.getAttribute("aria-label");
  const id = active.id || null;
  if (dataAttributes.length === 0 && !ariaLabel && !id) return null;

  let selection = null;
  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    && active.type !== "password"
    && Number.isInteger(active.selectionStart)
    && Number.isInteger(active.selectionEnd)
  ) {
    selection = [active.selectionStart, active.selectionEnd];
  }

  return Object.freeze({
    tagName: active.tagName,
    dataAttributes: Object.freeze(dataAttributes),
    ariaLabel,
    id,
    selection,
  });
}

function matchesFocusIdentity(element, identity) {
  if (element.tagName !== identity.tagName) return false;
  if (identity.id && element.id !== identity.id) return false;
  if (
    identity.ariaLabel
    && element.getAttribute("aria-label") !== identity.ariaLabel
  ) {
    return false;
  }
  return identity.dataAttributes.every(
    ([name, value]) => element.getAttribute(name) === value,
  );
}

function restoreFocus(slot, identity) {
  if (!identity) return;
  const candidates = slot.querySelectorAll(identity.tagName.toLowerCase());
  const target = Array.from(candidates).find((element) =>
    matchesFocusIdentity(element, identity)
  );
  if (!(target instanceof HTMLElement) || target.matches(":disabled")) return;
  target.focus({ preventScroll: true });
  if (
    identity.selection
    && typeof target.setSelectionRange === "function"
    && target.type !== "password"
  ) {
    target.setSelectionRange(identity.selection[0], identity.selection[1]);
  }
}

export function repaintPreservingInteraction(slot, paint) {
  if (!(slot instanceof Element) || typeof paint !== "function") {
    throw new TypeError("Interaction-preserving repaint requires a slot and painter");
  }

  const focusIdentity = captureFocusIdentity(slot);
  const scrollContainer = slot.closest(".ordax-window-body");
  const scrollTop = scrollContainer?.scrollTop ?? 0;
  const scrollLeft = scrollContainer?.scrollLeft ?? 0;

  paint();

  if (scrollContainer) {
    scrollContainer.scrollTop = scrollTop;
    scrollContainer.scrollLeft = scrollLeft;
  }
  restoreFocus(slot, focusIdentity);
}
