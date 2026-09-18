import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
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
  assertSyncRuntimePort,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import {
  assertWorkspaceMetadataSource,
  validateWorkspaceMetadata,
} from "../../contracts/workspace-metadata-source.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";
import { repaintPreservingInteraction } from "./view-interaction.mjs";

const ACCOUNT_WINDOW_SELECTOR = '[data-window-id="account"]';
const ACCOUNT_EXTENSION_SELECTOR = '[data-app-extension="account-overview"]';

const ACCOUNT_SECTIONS = Object.freeze([
  Object.freeze({ id: "overview", label: "Visão geral" }),
  Object.freeze({ id: "sync", label: "Sincronização" }),
]);

const SECTION_COPY = Object.freeze({
  overview: Object.freeze({
    title: "Conta",
    subtitle: "Identidade disponível nesta composição, sem simular login ou perfil remoto.",
  }),
  sync: Object.freeze({
    title: "Sincronização",
    subtitle: "Estado local preparado para continuidade, sem afirmar envio à nuvem sem transporte confirmado.",
  }),
});

function validAccountSection(value) {
  return ACCOUNT_SECTIONS.some((section) => section.id === value);
}

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
  identitySession,
  identityActions,
  surfaceLifecycle = null,
  syncRuntime = null,
  workspaceMetadataSource = null,
  appActivation = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Account overview controls require a Surface root Element");
  }

  const sessionPort = assertIdentitySessionPort(identitySession);
  const actionsPort = assertIdentityActionsPort(identityActions);
  const syncPort = syncRuntime === null ? null : assertSyncRuntimePort(syncRuntime);
  const workspaceMetadataPort = workspaceMetadataSource === null
    ? null
    : assertWorkspaceMetadataSource(workspaceMetadataSource);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;


  let sessionSnapshot = validateIdentitySessionSnapshot(sessionPort.getSnapshot());
  let actionsSnapshot = validateIdentityActionsSnapshot(actionsPort.getSnapshot());
  let syncSnapshot = syncPort ? validateSyncRuntimeSnapshot(syncPort.getSnapshot()) : null;
  let workspaceMetadataSnapshot = workspaceMetadataPort
    ? validateWorkspaceMetadata(workspaceMetadataPort.getSnapshot())
    : null;
  let pendingAction = null;
  let actionMessage = "";
  let actionOrdinal = 0;
  let activeSection = validAccountSection(lifecycle.getAppTarget("account"))
    ? lifecycle.getAppTarget("account")
    : "overview";
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${ACCOUNT_WINDOW_SELECTOR} ${ACCOUNT_EXTENSION_SELECTOR}`);

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-account-header");
    const copy = SECTION_COPY[activeSection];
    header.append(
      node(documentObject, "span", "ordax-account-eyebrow", "Conta"),
      node(documentObject, "h3", "ordax-account-title", copy.title),
      node(documentObject, "p", "ordax-account-subtitle", copy.subtitle),
    );
    view.append(header);
  };

  const renderSectionNavigation = (view) => {
    const navigation = node(documentObject, "nav", "ordax-account-navigation");
    navigation.setAttribute("aria-label", "Seções de Conta");
    for (const section of ACCOUNT_SECTIONS) {
      const button = node(documentObject, "button", "ordax-account-navigation-item", section.label);
      button.type = "button";
      button.dataset.accountSection = section.id;
      const active = activeSection === section.id;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      navigation.append(button);
    }
    view.append(navigation);
  };

  const renderIdentity = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    const heading = node(documentObject, "div", "ordax-account-section-heading");
    const copy = node(documentObject, "div");
    copy.append(
      node(documentObject, "span", "ordax-account-eyebrow", "Identidade"),
      node(documentObject, "h4", "ordax-account-section-title", "Sessão OrdaX"),
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
      node(documentObject, "span", "ordax-account-eyebrow", "Estado local"),
      node(documentObject, "h4", "ordax-account-section-title", "Continuidade preparada neste dispositivo"),
      node(
        documentObject,
        "p",
        "ordax-account-subtitle",
        "Estes dados descrevem apenas a fila e o metadata locais. Nada é chamado de sincronizado sem confirmação de um transporte autenticado.",
      ),
    );

    const grid = node(documentObject, "div", "ordax-account-grid");
    const pendingMutationCount = syncSnapshot?.pendingMutationCount ?? 0;
    const appearanceTracked = syncSnapshot?.trackedDataClasses.includes("appearance") ?? false;
    const queueIsDurable = syncSnapshot?.queuePersistence === "device";
    const workspaceAreaCount = workspaceMetadataSnapshot?.areas.length ?? 0;
    const workspaceAppCount = workspaceMetadataSnapshot
      ? workspaceMetadataSnapshot.areas.reduce((total, area) => total + area.appIds.length, 0)
      : 0;

    appendStateCard(
      documentObject,
      grid,
      "Alterações locais",
      syncSnapshot
        ? pendingMutationCount > 0
          ? `${pendingMutationCount} pendente${pendingMutationCount === 1 ? "" : "s"}`
          : "Nenhuma pendência"
        : "Estado indisponível",
      syncSnapshot
        ? pendingMutationCount > 0
          ? "As alterações aguardam um transporte autenticado; nada foi anunciado como enviado à nuvem."
          : "A fila local está vazia; isso não prova que exista uma conta ou nuvem sincronizada."
        : "Esta composição não expõe o runtime local de sincronização.",
      syncSnapshot ? (pendingMutationCount > 0 ? "neutral" : "available") : "unavailable",
    );

    appendStateCard(
      documentObject,
      grid,
      "Aparência",
      appearanceTracked ? "Acompanhada localmente" : "Não acompanhada",
      appearanceTracked
        ? "Mudanças de aparência entram no núcleo local de continuidade, sem ativar transporte por conta própria."
        : "A aparência continua funcional localmente sem depender de sincronização.",
      appearanceTracked ? "available" : "neutral",
    );

    appendStateCard(
      documentObject,
      grid,
      "Áreas e apps",
      workspaceMetadataSnapshot
        ? `${workspaceAreaCount} área${workspaceAreaCount === 1 ? "" : "s"} · ${workspaceAppCount} app${workspaceAppCount === 1 ? "" : "s"}`
        : "Metadata indisponível",
      workspaceMetadataSnapshot
        ? "Somente áreas e apps abertos entram no metadata portátil; posição, tamanho, maximização e minimização continuam locais."
        : "A composição atual ainda não expõe metadata portátil do workspace.",
      workspaceMetadataSnapshot ? "available" : "neutral",
    );

    appendStateCard(
      documentObject,
      grid,
      "Fila offline",
      syncSnapshot
        ? queueIsDurable
          ? "Persistente neste dispositivo"
          : "Somente nesta sessão"
        : "Indisponível",
      syncSnapshot
        ? queueIsDurable
          ? "A fila sobrevive a reload/reinício neste dispositivo e continua local até existir transporte autorizado."
          : "Pendências podem ser perdidas ao encerrar a sessão desta composição; nenhum dado foi enviado."
        : "Nenhuma fila local foi exposta por esta composição.",
      syncSnapshot ? (queueIsDurable ? "available" : "neutral") : "unavailable",
    );

    section.append(grid);
    view.append(section);
  };

  const paint = (slot) => {
    slot.replaceChildren();
    slot.dataset.ordaxAccountOverviewView = "";
    slot.dataset.accountSection = activeSection;
    const view = node(documentObject, "div", "ordax-account-view");
    renderHeader(view);
    renderSectionNavigation(view);
    if (activeSection === "overview") {
      renderIdentity(view);
    } else if (activeSection === "sync") {
      renderContinuity(view);
    }
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
    repaintPreservingInteraction(slot, () => paint(slot));
  };

  const replaceView = () => renderView(true);

  const invoke = async (action) => {
    if (
      pendingAction !== null ||
      !isIdentityActionSupported(actionsSnapshot, action)
    ) {
      return;
    }
    const ordinal = ++actionOrdinal;
    pendingAction = action;
    actionMessage = "";
    replaceView();
    try {
      await actionsPort.execute(action);
      if (destroyed || ordinal !== actionOrdinal) return;
    } catch {
      if (destroyed || ordinal !== actionOrdinal) return;
      actionMessage = "A ação de conta não pôde ser concluída por este host.";
    } finally {
      if (!destroyed && ordinal === actionOrdinal) {
        pendingAction = null;
        replaceView();
      }
    }
  };

  const onClick = (event) => {
    const sectionButton = event.target.closest("[data-account-section]");
    if (
      sectionButton
      && root.contains(sectionButton)
      && validAccountSection(sectionButton.dataset.accountSection)
    ) {
      const nextSection = sectionButton.dataset.accountSection;
      actionMessage = "";
      if (activationPort) {
        activationPort.publish({ appId: "account", target: nextSection });
      } else {
        activeSection = nextSection;
        replaceView();
      }
      return;
    }

    const button = event.target.closest("[data-account-identity-action]");
    if (button && root.contains(button)) {
      void invoke(button.dataset.accountIdentityAction);
    }
  };

  root.addEventListener("click", onClick);
  const unsubscribeRender = lifecycle.subscribeRender(() => {
    const persistedTarget = lifecycle.getAppTarget("account");
    const nextSection = validAccountSection(persistedTarget) ? persistedTarget : "overview";
    if (nextSection !== activeSection) actionMessage = "";
    activeSection = nextSection;
    renderView(false);
  });
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (
      activation.appId === "account"
      && activation.target !== null
      && validAccountSection(activation.target)
    ) {
      activeSection = activation.target;
      actionMessage = "";
      replaceView();
    }
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
  const unsubscribeSync = syncPort?.subscribe((snapshot) => {
    syncSnapshot = validateSyncRuntimeSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeWorkspaceMetadata = workspaceMetadataPort?.subscribe((snapshot) => {
    workspaceMetadataSnapshot = validateWorkspaceMetadata(snapshot);
    replaceView();
  });

  return Object.freeze({
    destroy() {
      destroyed = true;
      actionOrdinal += 1;
      unsubscribeWorkspaceMetadata?.();
      unsubscribeSync?.();
      unsubscribeActions?.();
      unsubscribeSession?.();
      unsubscribeActivation?.();
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
