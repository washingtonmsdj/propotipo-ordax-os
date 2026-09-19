const BOOT_SCREEN_ID = "ordax-boot-screen";
const STATUS_SELECTOR = "[data-ordax-boot-status]";

export function createSurfaceBootScreen(documentObject = globalThis.document) {
  if (!documentObject || typeof documentObject.querySelector !== "function") {
    throw new TypeError("Surface boot screen requires a document");
  }
  const element = documentObject.querySelector(`#${BOOT_SCREEN_ID}`);
  if (!(element instanceof Element)) {
    throw new TypeError("Surface boot screen element is missing");
  }
  const status = element.querySelector(STATUS_SELECTOR);
  if (!(status instanceof Element)) {
    throw new TypeError("Surface boot screen status element is missing");
  }

  let finished = false;

  const setStage = (message) => {
    if (finished) return false;
    const text = String(message ?? "").trim();
    if (!text) return false;
    status.textContent = text;
    element.dataset.state = "loading";
    return true;
  };

  return Object.freeze({
    setStage,
    ready() {
      if (finished) return false;
      finished = true;
      element.dataset.state = "ready";
      element.setAttribute("aria-hidden", "true");
      element.hidden = true;
      return true;
    },
    fail(message = "Não foi possível iniciar a interface") {
      if (finished) return false;
      const text = String(message ?? "").trim() || "Não foi possível iniciar a interface";
      status.textContent = text;
      element.dataset.state = "error";
      element.removeAttribute("aria-hidden");
      return true;
    },
    isFinished() {
      return finished;
    },
  });
}
