import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { updateIsAlerting } from "../../services/update/presentation.mjs";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountUpdateControls(root, updatePort, appActivation) {
  if (!(root instanceof Element)) {
    throw new TypeError("Update controls root must be a DOM Element");
  }
  if (!updatePort || typeof updatePort.subscribe !== "function" || typeof updatePort.getSnapshot !== "function") {
    throw new TypeError("Update controls require a native update watcher port");
  }
  const activationPort = assertAppActivationPort(appActivation);

  const documentObject = root.ownerDocument;
  const slot = root.querySelector("[data-update-slot]");
  if (!slot) {
    throw new Error("Surface update controls require the shared shell update slot");
  }

  const button = node(documentObject, "button", "ordax-status-action", "Atualizações");
  button.type = "button";
  button.dataset.updateOpenSystem = "";
  button.setAttribute("aria-label", "Abrir Sistema, Atualizações");
  slot.append(button);

  let snapshot = updatePort.getSnapshot();

  const render = () => {
    const alerting = updateIsAlerting(snapshot);
    button.textContent = alerting ? "Atualizações •" : "Atualizações";
    button.dataset.alerting = String(alerting);
    button.title = alerting
      ? "Há uma atualização que requer atenção. Abrir Sistema > Atualizações."
      : "Abrir Sistema > Atualizações";
  };

  const onClick = (event) => {
    const target = event.target.closest("[data-update-open-system]");
    if (!target || !root.contains(target)) return;
    activationPort.publish({ appId: "system", target: "updates" });
  };

  root.addEventListener("click", onClick);
  const unsubscribe = updatePort.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    render();
  });
  render();

  return Object.freeze({
    destroy() {
      unsubscribe?.();
      root.removeEventListener("click", onClick);
      button.remove();
    },
  });
}
