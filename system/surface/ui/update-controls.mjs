// Fast-path validation after reload fallback hardening; no behavior change.
// Lightweight-staging latency probe: no behavior change; measures the live reload path.
// Staged-slot latency probe: no behavior change; exercises the live reload path.
// Fast-path probe: this UI file is intentionally safe for live Surface reloads.
const STATUS_COPY = Object.freeze({
  running: ["Atualizado", "A Surface está executando a entrega sincronizada."],
  applied: ["Aplicando atualização", "Uma nova entrega foi recebida e está sendo ativada."],
  updating: ["Atualizando…", "O OrdaX está recebendo uma nova entrega."],
  "network-error": ["Sem conexão", "A entrega atual continua funcionando e uma nova tentativa será feita automaticamente."],
  "remote-error": ["Fonte de atualização indisponível", "A entrega atual foi preservada."],
  "pull-error": ["Falha ao atualizar", "A entrega atual foi preservada e o OrdaX tentará novamente."],
  "rolled-back": ["Atualização revertida", "A nova entrega não ficou saudável e o OrdaX voltou automaticamente para a entrega anterior."],
  rejected: ["Entrega bloqueada", "Uma atualização com falha foi bloqueada até existir uma nova entrega candidata."],
  pinned: ["Entrega fixada", "As atualizações automáticas estão pausadas por uma entrega fixada."],
  disabled: ["Atualização indisponível", "Este ambiente não possui o fluxo automático de entregas ativo."],
  unavailable: ["Estado indisponível", "O host ainda não publicou o estado do atualizador."],
});

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortSha(value) {
  if (typeof value !== "string" || value.length < 8 || value === "unavailable") return "—";
  return value.slice(0, 8);
}

function deliveryLabel(value) {
  return Number.isSafeInteger(value) && value > 0 ? `Entrega ${value}` : "Entrega sem número";
}

function formatTimestamp(value) {
  if (typeof value !== "string" || !value || value === "unknown") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function readableMode(mode) {
  switch (mode) {
    case "reload": return "Recarga rápida da Surface";
    case "surface-restart": return "Reinício somente da Surface";
    case "supervisor-restart": return "Reinício do supervisor";
    case "initial": return "Inicialização";
    default: return "Sem ação pendente";
  }
}

function readablePhase(phase) {
  switch (phase) {
    case "checking": return "Verificando atualizações";
    case "fetching": return "Baixando entrega";
    case "validating": return "Validando sistema";
    case "activating": return "Ativando entrega";
    case "health-wait": return "Aguardando confirmação de saúde";
    case "rollback": return "Revertendo automaticamente";
    case "blocked": return "Bloqueada";
    case "error": return "Falha";
    default: return "Em repouso";
  }
}

function statusDescriptor(snapshot) {
  if (snapshot?.bootRefreshRequired) {
    return ["Reinício necessário", "Há uma atualização de boot/bootstrap pendente. O OrdaX não reiniciará sozinho."];
  }
  return STATUS_COPY[snapshot?.status] ?? ["Atualização automática", "O estado atual ainda não foi classificado."];
}

export function mountUpdateControls(root, updatePort) {
  if (!(root instanceof Element)) {
    throw new TypeError("Update controls root must be a DOM Element");
  }
  if (!updatePort || typeof updatePort.subscribe !== "function" || typeof updatePort.getSnapshot !== "function") {
    throw new TypeError("Update controls require a native update watcher port");
  }

  const documentObject = root.ownerDocument;
  const shell = root.querySelector("[data-ordax-shell]");
  const slot = root.querySelector("[data-update-slot]");
  if (!shell || !slot) {
    throw new Error("Surface update controls require the shared shell update slot");
  }

  const toggle = node(documentObject, "button", "ordax-status-action", "Atualizações");
  toggle.type = "button";
  toggle.dataset.updateToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Abrir estado das atualizações");
  slot.append(toggle);

  const overlay = node(documentObject, "div", "ordax-launcher ordax-update-menu");
  overlay.dataset.updateMenu = "";
  overlay.hidden = true;
  const panel = node(documentObject, "div", "ordax-launcher-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Atualizações do OrdaX");
  const heading = node(documentObject, "div", "ordax-launcher-heading");
  heading.append(
    node(documentObject, "span", "", "Atualizações"),
    node(documentObject, "small", "", "Entrega automática e recuperação"),
  );
  const grid = node(documentObject, "div", "ordax-launcher-grid");
  const detail = node(documentObject, "p", "ordax-empty", "");
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");
  panel.append(heading, grid, detail);
  overlay.append(panel);
  shell.append(overlay);

  let open = false;
  let snapshot = updatePort.getSnapshot();

  const addFact = (mark, title, copy) => {
    const item = node(documentObject, "div", "ordax-launcher-app");
    const text = node(documentObject, "span", "ordax-launcher-app-copy");
    text.append(node(documentObject, "strong", "", title), node(documentObject, "small", "", copy));
    item.append(node(documentObject, "span", "ordax-app-mark", mark), text);
    grid.append(item);
  };

  const render = () => {
    overlay.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    grid.replaceChildren();
    const [label, description] = statusDescriptor(snapshot);
    const alerting = Boolean(snapshot?.bootRefreshRequired) || ["network-error", "remote-error", "pull-error", "rolled-back", "rejected"].includes(snapshot?.status);
    toggle.textContent = alerting ? "Atualizações •" : "Atualizações";
    toggle.dataset.alerting = String(alerting);
    addFact(alerting ? "!" : "✓", label, description);
    addFact("#", deliveryLabel(snapshot?.deliveryNumber), `SHA técnico ${shortSha(snapshot?.sourceSha)} · ${readableMode(snapshot?.applyMode)}`);
    if (snapshot?.runtimeSurfaceSha) {
      addFact(
        "◇",
        `Surface ${shortSha(snapshot.runtimeSurfaceSha)}`,
        snapshot.runtimeSurfaceSha === snapshot.sourceSha
          ? "Runtime alinhado com a entrega observada."
          : "Runtime mantido no último commit com efeito na Surface.",
      );
    }
    if (snapshot?.targetSha) {
      addFact("→", `Alvo ${shortSha(snapshot.targetSha)}`, `Fase: ${readablePhase(snapshot?.phase)}`);
    } else if (snapshot?.phase && snapshot.phase !== "idle") {
      addFact("…", "Fase atual", readablePhase(snapshot.phase));
    }
    if (snapshot?.attemptId) {
      addFact("·", "Tentativa", formatTimestamp(snapshot.attemptId));
    }
    if (snapshot?.lastError) {
      addFact("!", "Diagnóstico", snapshot.lastError);
    }
    if (snapshot?.lastAppliedAt && snapshot.lastAppliedAt !== "unknown") {
      addFact(
        "↻",
        "Última aplicação",
        `${formatTimestamp(snapshot.lastAppliedAt)} · ${snapshot.lastApplyDurationSeconds ?? 0}s (preparação ${snapshot.lastStageDurationSeconds ?? 0}s)`,
      );
    }
    if (snapshot?.rejectedSha) {
      addFact("×", `Bloqueada ${shortSha(snapshot.rejectedSha)}`, "O OrdaX não tentará este commit novamente enquanto não existir uma nova entrega candidata.");
    }
    detail.textContent = snapshot?.checkedAt && snapshot.checkedAt !== "unknown"
      ? `Última verificação automática: ${formatTimestamp(snapshot.checkedAt)}`
      : "A verificação automática ocorre em segundo plano.";
  };

  const onRootClick = (event) => {
    if (event.target.closest("[data-update-toggle]")) {
      open = !open;
      render();
      return;
    }
    if (open && !event.target.closest("[data-update-menu]")) {
      open = false;
      render();
    }
  };

  const onRootKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      open = false;
      render();
      toggle.focus();
    }
  };

  root.addEventListener("click", onRootClick);
  root.addEventListener("keydown", onRootKeyDown);
  const unsubscribe = updatePort.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    render();
  });
  render();

  return Object.freeze({
    destroy() {
      unsubscribe?.();
      root.removeEventListener("click", onRootClick);
      root.removeEventListener("keydown", onRootKeyDown);
      overlay.remove();
      toggle.remove();
    },
  });
}
