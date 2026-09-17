import {
  assertIdentityActionsPort,
  isIdentityActionSupported,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import { SYNC_CORE_STATUS } from "../../services/sync/runtime.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const ACCOUNT_WINDOW_SELECTOR = '[data-window-id="account"]';
const ACCOUNT_EXTENSION_SELECTOR = '[data-app-extension="account-overview"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sessionLabel(snapshot) {
  if (snapshot.state === "signed-in") return "Sessão ativa";
  if (snapshot.state === "signed-out") return "Sem sessão";
  return "Identidade indisponível";
}

function sessionDescription(snapshot) {
  if (snapshot.state === "signed-in") {
    return "Esta Surface recebeu uma identidade autenticada do host autorizado.";
  }
  if (snapshot.state === "signed-out") {
    return "O host oferece identidade, mas nenhuma sessão está ativa.";
  }
  return "Este host não oferece identidade autenticada. O OrdaX não simula um provedor de login.";
}

function desiredAction(session, actions) {
  if (session.state === "signed-out" && isIdentityActionSupported(actions, "sign-in")) {
    return "sign-in";
  }
  if (session.state === "signed-in" && isIdentityActionSupported(actions, "sign-out")) {
    return "sign-out";
  }
  return null;
}

function appendStateCard(documentObject, container, label, value, detail, state = "neutral") {
  const card = node(documentObject, "article", "ordax-account-card");
  card.dataset.state = state;
  card.append(
    node(documentObject, "span", "ordax-account-card-label", label),
    node(documentObject, "strong", "ordax-account-card-value", value),
    node(documentObject, "small", "ordax-account-card-detail", detail),
  );
  container.append(card);
}

export function mountAccountOverviewControls(
  root,
  host,
  identitySession,
  identityActions,
  surfaceLifecycle = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Account overview controls require a Surface root Element");
  }

  const hostPort = assertSurfaceHost(host);
  const sessionPort = assertIdentitySessionPort(identitySession);
  const actionsPort = assertIdentityActionsPort(identityActions);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let sessionSnapshot = validateIdentitySessionSnapshot(sessionPort.getSnapshot());
  let actionsSnapshot = validateIdentityActionsSnapshot(actionsPort.getSnapshot());
  let pendingAction = null;
  let actionMessage = "";
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${ACCOUNT_WINDOW_SELECTOR} ${ACCOUNT_EXTENSION_SELECTOR}`);

  const renderIdentity = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    const heading = node(documentObject, "div", "ordax-account-section-heading");
    const copy = node(documentObject, "div");
    copy.append(
      node(documentObject, "span", "ordax-account-eyebrow", "Identidade"),
      node(documentObject, "h3", "ordax-account-title", "Conta OrdaX"),
      node(documentObject, "p", "ordax-account-subtitle", sessionDescription(sessionSnapshot)),
    );

    const status = node(documentObject, "span", "ordax-account-status", sessionLabel(sessionSnapshot));
    status.dataset.state = sessionSnapshot.state;
    heading.append(copy, status);
    section.append(heading);

    if (sessionSnapshot.state === "signed-in") {
      const identity = node(documentObject, "div", "ordax-account-identity");
      const avatar = node(
        documentObject,
        "span",
        "ordax-account-avatar",
        sessionSnapshot.displayName.trim().slice(0, 1).toLocaleUpperCase(),
      );
      const identityCopy = node(documentObject, "div", "ordax-account-identity-copy");
      identityCopy.append(
        node(documentObject, "strong", "", sessionSnapshot.displayName),
        node(documentObject, "small", "", `Identidade: ${sessionSnapshot.subjectId}`),
      );
      identity.append(avatar, identityCopy);
      section.append(identity);
    }

    const action = desiredAction(sessionSnapshot, actionsSnapshot);
    const actions = node(documentObject, "div", "ordax-account-actions");
    if (action) {
      const label = pendingAction === action
        ? action === "sign-in" ? "Entrando…" : "Saindo…"
        : action === "sign-in" ? "Entrar" : "Sair";
      const button = node(documentObject, "button", "ordax-account-action ordax-account-action-primary", label);
      button.type = "button";
      button.dataset.accountIdentityAction = action;
      button.disabled = pendingAction !== null;
      actions.append(button);
    } else {
      actions.append(
        node(
          documentObject,
          "span",
          "ordax-account-action-note",
          sessionSnapshot.state === "unavailable"
            ? "Ações de conta indisponíveis neste host."
            : "Nenhuma ação de sessão disponível.",
        ),
      );
    }
    section.append(actions);

    if (actionMessage) {
      section.append(node(documentObject, "p", "ordax-account-message", actionMessage));
    }
    view.append(section);
  };

  const renderContinuity = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", "Continuidade"),
      node(documentObject, "h4", "ordax-account-section-title", "Estado compartilhado com limites explícitos"),
    );

    const grid = node(documentObject, "div", "ordax-account-grid");
    const identityAvailable = hostSnapshot.capabilityIds.includes("account.identity");
    const syncAvailable = hostSnapshot.capabilityIds.includes("sync.safe-state");

    appendStateCard(
      documentObject,
      grid,
      "Identidade do host",
      identityAvailable ? "Disponível" : "Indisponível",
      identityAvailable
        ? "O host declarou capacidade de identidade autenticada."
        : "Nenhuma identidade autenticada foi anunciada.",
      identityAvailable ? "available" : "unavailable",
    );
    appendStateCard(
      documentObject,
      grid,
      "Sincronização segura",
      syncAvailable ? "Ativa" : "Não ativa",
      syncAvailable
        ? "O host pode sincronizar somente classes de estado autorizadas."
        : "O estado permanece local até existir um transporte autorizado.",
      syncAvailable ? "available" : "neutral",
    );
    appendStateCard(
      documentObject,
      grid,
      "Protocolo de sync",
      SYNC_CORE_STATUS.protocolCore === "implemented" ? "Preparado" : "Indisponível",
      "O protocolo compartilhado é independente do provedor de identidade.",
      SYNC_CORE_STATUS.protocolCore === "implemented" ? "available" : "unavailable",
    );
    appendStateCard(
      documentObject,
      grid,
      "Fila offline",
      SYNC_CORE_STATUS.offlineMutationQueue === "implemented" ? "Preparada" : "Indisponível",
      "Mutações locais podem aguardar conectividade sem inventar uma sessão.",
      SYNC_CORE_STATUS.offlineMutationQueue === "implemented" ? "available" : "unavailable",
    );
    section.append(grid);
    view.append(section);
  };

  const renderPrivacy = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", "Fronteira"),
      node(documentObject, "h4", "ordax-account-section-title", "O dispositivo continua sendo uma fronteira de confiança"),
    );
    const facts = node(documentObject, "div", "ordax-account-facts");
    for (const [title, detail] of [
      ["Segredos de dispositivo", "Permanecem locais e não fazem parte do estado sincronizável."],
      ["Provedor de login", "É responsabilidade de um adapter autorizado; a Surface não conhece Google, Microsoft ou passkeys."],
      ["Estado sincronizável", "Só cruza dispositivos quando classificado e permitido pelo contrato de sync."],
    ]) {
      const fact = node(documentObject, "div", "ordax-account-fact");
      fact.append(
        node(documentObject, "strong", "", title),
        node(documentObject, "span", "", detail),
      );
      facts.append(fact);
    }
    section.append(facts);
    view.append(section);
  };

  const paint = (slot) => {
    slot.replaceChildren();
    slot.dataset.ordaxAccountOverviewView = "";
    const view = node(documentObject, "div", "ordax-account-view");
    renderIdentity(view);
    renderContinuity(view);
    renderPrivacy(view);
    slot.append(view);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    mountedSlot = slot;
    paint(slot);
  };

  const replaceView = () => renderView(true);

  const invoke = async (action) => {
    if (
      pendingAction !== null ||
      !isIdentityActionSupported(actionsSnapshot, action)
    ) {
      return;
    }
    pendingAction = action;
    actionMessage = "";
    replaceView();
    try {
      await actionsPort.execute(action);
    } catch {
      actionMessage = "A ação de conta não pôde ser concluída por este host.";
    } finally {
      pendingAction = null;
      replaceView();
    }
  };

  const onClick = (event) => {
    const button = event.target.closest("[data-account-identity-action]");
    if (button && root.contains(button)) {
      void invoke(button.dataset.accountIdentityAction);
    }
  };

  root.addEventListener("click", onClick);
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeHost = hostPort.subscribe((snapshot) => {
    hostSnapshot = validateSurfaceSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeSession = sessionPort.subscribe((snapshot) => {
    sessionSnapshot = validateIdentitySessionSnapshot(snapshot);
    actionMessage = "";
    replaceView();
  });
  const unsubscribeActions = actionsPort.subscribe((snapshot) => {
    actionsSnapshot = validateIdentityActionsSnapshot(snapshot);
    actionMessage = "";
    replaceView();
  });

  return Object.freeze({
    destroy() {
      destroyed = true;
      unsubscribeActions?.();
      unsubscribeSession?.();
      unsubscribeHost?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      const slot = findSlot();
      if (slot?.dataset.ordaxAccountOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxAccountOverviewView;
      }
      mountedSlot = null;
    },
  });
}
