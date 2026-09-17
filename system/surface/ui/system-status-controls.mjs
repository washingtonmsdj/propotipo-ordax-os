import {
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";

const SYSTEM_WINDOW_SELECTOR = '[data-window-id="system"]';

const STATUS_LABELS = Object.freeze({
  running: "Atualizado",
  applied: "Atualização aplicada",
  updating: "Atualizando",
  "network-error": "Sem conexão",
  "remote-error": "Git remoto indisponível",
  "pull-error": "Falha ao atualizar",
  "rolled-back": "Atualização revertida",
  rejected: "Versão bloqueada",
  pinned: "Versão fixada",
  disabled: "Atualização indisponível",
  unavailable: "Estado indisponível",
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortSha(value) {
  return typeof value === "string" && value.length >= 8 ? value.slice(0, 8) : "—";
}

function readableMode(mode) {
  switch (mode) {
    case "reload": return "recarga da Surface";
    case "surface-restart": return "reinício da Surface";
    case "supervisor-restart": return "reinício do supervisor";
    case "initial": return "inicialização";
    default: return "sem ação pendente";
  }
}

export function mountSystemStatusControls(root, updateStatusPort) {
  if (!(root instanceof Element)) {
    throw new TypeError("System status controls require a Surface root Element");
  }
  const port = assertUpdateStatusPort(updateStatusPort);
  let snapshot = port.getSnapshot();
  let destroyed = false;

  const renderPanel = () => {
    if (destroyed) return;
    const body = root.querySelector(`${SYSTEM_WINDOW_SELECTOR} .ordax-window-body`);
    if (!body || body.querySelector("[data-ordax-system-status-panel]")) return;

    const section = element("section", "ordax-app-panel");
    section.dataset.ordaxSystemStatusPanel = "";
    section.append(element("span", "ordax-app-panel-label", "Execução"));
    section.append(element("h3", "ordax-app-panel-title", "Versão e atualizações"));

    if (!snapshot) {
      const badge = element("span", "ordax-inline-status", "Aguardando supervisor…");
      badge.dataset.state = "unavailable";
      section.append(badge);
      section.append(element("p", "ordax-app-panel-body", "O estado será exibido assim que o host publicar a primeira verificação."));
      body.append(section);
      return;
    }

    const safe = validateUpdateStatusSnapshot(snapshot);
    const badge = element(
      "span",
      "ordax-inline-status",
      safe.bootRefreshRequired
        ? "Reinício físico pendente"
        : (STATUS_LABELS[safe.status] ?? safe.status),
    );
    const alerting = safe.bootRefreshRequired || [
      "network-error",
      "remote-error",
      "pull-error",
      "rolled-back",
      "rejected",
    ].includes(safe.status);
    badge.dataset.state = alerting ? "unavailable" : "available";
    section.append(badge);

    const facts = element("ul", "ordax-capability-list");
    facts.append(element("li", "", `Commit em execução: ${shortSha(safe.sourceSha)}`));
    facts.append(element("li", "", `Aplicação: ${readableMode(safe.applyMode)}`));
    if (safe.lastAppliedAt !== "unknown") {
      facts.append(element("li", "", `Última aplicação: ${safe.lastAppliedAt}`));
    }
    if (safe.rejectedSha) {
      facts.append(element("li", "", `Commit bloqueado: ${shortSha(safe.rejectedSha)}`));
    }
    if (safe.checkedAt !== "unknown") {
      facts.append(element("li", "", `Última verificação: ${safe.checkedAt}`));
    }
    section.append(facts);
    section.append(
      element(
        "p",
        "ordax-app-panel-body",
        safe.bootRefreshRequired
          ? "Uma mudança de boot/bootstrap foi detectada. O OrdaX não reiniciará a máquina automaticamente."
          : "Atualizações normais continuam sendo aplicadas pelo supervisor sem depender de SSH ou shell remoto.",
      ),
    );
    body.append(section);
  };

  const replacePanel = () => {
    root.querySelector(`${SYSTEM_WINDOW_SELECTOR} [data-ordax-system-status-panel]`)?.remove();
    renderPanel();
  };

  const observer = new MutationObserver(() => renderPanel());
  observer.observe(root, { childList: true, subtree: true });
  const unsubscribe = port.subscribe((nextSnapshot) => {
    snapshot = validateUpdateStatusSnapshot(nextSnapshot);
    replacePanel();
  });
  renderPanel();

  return Object.freeze({
    destroy() {
      destroyed = true;
      unsubscribe?.();
      observer.disconnect();
      root.querySelector(`${SYSTEM_WINDOW_SELECTOR} [data-ordax-system-status-panel]`)?.remove();
    },
  });
}
