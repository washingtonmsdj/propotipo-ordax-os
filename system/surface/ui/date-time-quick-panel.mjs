import {
  assertTimeStatusPort,
  validateTimeStatusSnapshot,
} from "../../contracts/time-status.mjs";

export function mountDateTimeQuickPanel(root, timeStatus = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("Date/time quick panel requires a Surface root Element");
  }
  const port = timeStatus === null ? null : assertTimeStatusPort(timeStatus);
  const panel = root.querySelector('[data-quick-panel="datetime"]');
  const state = root.querySelector("[data-quick-time-sync-state]");
  if (!panel || !state) {
    throw new Error("Date/time quick panel requires shared shell slots");
  }

  let destroyed = false;
  let reading = false;

  const renderUnavailable = (copy) => {
    state.textContent = copy;
    state.dataset.state = "unavailable";
  };

  const refresh = async () => {
    if (destroyed || reading) return;
    if (!port) {
      renderUnavailable("Indisponível neste ambiente");
      return;
    }

    reading = true;
    state.textContent = "Verificando…";
    state.dataset.state = "checking";
    try {
      const snapshot = validateTimeStatusSnapshot(await port.read());
      if (snapshot.automaticSync === "running") {
        state.textContent = "Em execução";
        state.dataset.state = "running";
      } else {
        renderUnavailable("Indisponível nesta sessão");
      }
    } catch {
      renderUnavailable("Indisponível nesta sessão");
    } finally {
      reading = false;
    }
  };

  const onOpen = () => void refresh();
  panel.addEventListener("ordax:quick-panel-open", onOpen);
  void refresh();

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
    },
  });
}
