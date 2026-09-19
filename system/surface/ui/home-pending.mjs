import {
  assertNotificationsPort,
  validateNotificationsSnapshot,
} from "../../contracts/notifications.mjs";
import {
  assertSyncRuntimePort,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";

const MAX_HOME_PENDING_ITEMS = 2;

function plural(value, singular, pluralValue) {
  return value === 1 ? singular : pluralValue;
}

function notificationsDetail(snapshot) {
  const parts = ["Central de Notificações"];
  if (snapshot.doNotDisturb) parts.push("Não perturbe ativo");
  if (snapshot.persistence === "session") parts.push("histórico somente nesta sessão");
  return parts.join(" · ");
}

function syncDetail(snapshot) {
  const parts = [
    snapshot.transport === "available"
      ? "transporte disponível"
      : "transporte remoto não está ativo",
    snapshot.accountContinuity === "active"
      ? "continuidade de conta ativa"
      : "continuidade de conta não está ativa",
    snapshot.queuePersistence === "device"
      ? "fila salva neste dispositivo"
      : "fila somente nesta sessão",
  ];
  return parts.join(" · ");
}

export function createHomePendingPresentation({
  notifications = null,
  syncRuntime = null,
} = {}) {
  const notificationsSnapshot = notifications === null
    ? null
    : validateNotificationsSnapshot(notifications);
  const syncSnapshot = syncRuntime === null
    ? null
    : validateSyncRuntimeSnapshot(syncRuntime);
  const items = [];

  if (notificationsSnapshot?.unreadCount > 0) {
    const unread = notificationsSnapshot.unreadCount;
    items.push(Object.freeze({
      key: "notifications",
      kind: "notifications",
      title: `${unread} ${plural(unread, "notificação não lida", "notificações não lidas")}`,
      detail: notificationsDetail(notificationsSnapshot),
      actionLabel: `Abrir notificações — ${unread} não ${plural(unread, "lida", "lidas")}`,
      actionKind: "quick-panel",
      panel: "notifications",
      appId: null,
      target: null,
    }));
  }

  if (syncSnapshot?.pendingMutationCount > 0) {
    const pending = syncSnapshot.pendingMutationCount;
    items.push(Object.freeze({
      key: "sync",
      kind: "sync",
      title: `${pending} ${plural(pending, "alteração local pendente", "alterações locais pendentes")}`,
      detail: syncDetail(syncSnapshot),
      actionLabel: "Abrir Conta em Sincronização",
      actionKind: "app",
      panel: null,
      appId: "account",
      target: "sync",
    }));
  }

  const boundedItems = items.slice(0, MAX_HOME_PENDING_ITEMS);
  return Object.freeze({
    visible: boundedItems.length > 0,
    items: Object.freeze(boundedItems),
  });
}

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function assertHomeRoot(root) {
  if (
    !root
    || typeof root !== "object"
    || typeof root.querySelector !== "function"
    || !root.ownerDocument
  ) {
    throw new TypeError("Home pending summary requires a Surface root");
  }
  return root;
}

function canonicalHomeSpace(homePanel) {
  return Array.from(homePanel.querySelectorAll(".ordax-space"))
    .find((element) => (
      element.dataset?.homeContinuation === undefined
      && element.dataset?.homePending === undefined
    )) ?? null;
}

export function mountHomePending(
  rootValue,
  { notifications = null, syncRuntime = null } = {},
) {
  const root = assertHomeRoot(rootValue);
  const notificationsPort = notifications === null ? null : assertNotificationsPort(notifications);
  const syncPort = syncRuntime === null ? null : assertSyncRuntimePort(syncRuntime);
  const documentObject = root.ownerDocument;
  const homePanel = root.querySelector(".ordax-home-panel");
  const space = homePanel ? canonicalHomeSpace(homePanel) : null;
  if (!homePanel || !space) {
    throw new Error("Home pending summary requires the canonical Home panel");
  }

  let destroyed = false;
  let section = null;
  let notificationsSnapshot = notificationsPort?.getSnapshot() ?? null;
  let syncSnapshot = syncPort?.getSnapshot() ?? null;

  const render = () => {
    if (destroyed) return;
    const focusedKey = documentObject.activeElement?.dataset?.homePendingKey ?? null;
    const presentation = createHomePendingPresentation({
      notifications: notificationsSnapshot,
      syncRuntime: syncSnapshot,
    });

    if (!presentation.visible) {
      section?.remove();
      section = null;
      return;
    }

    const next = node(documentObject, "section", "ordax-space");
    next.dataset.homePending = "";
    next.setAttribute("aria-labelledby", "ordax-home-pending-title");
    const heading = node(
      documentObject,
      "p",
      "ordax-section-kicker",
      "Pendências",
    );
    heading.id = "ordax-home-pending-title";
    next.append(heading);

    for (const item of presentation.items) {
      const button = node(documentObject, "button", "ordax-space-link");
      button.type = "button";
      button.dataset.homePendingKey = item.key;
      button.setAttribute("aria-label", item.actionLabel);
      if (item.actionKind === "quick-panel") {
        button.dataset.quickPanelToggle = item.panel;
        if (item.panel === "notifications") {
          button.setAttribute("aria-controls", "ordax-quick-notifications");
        }
      } else {
        button.dataset.launchApp = item.appId;
        button.dataset.appTarget = item.target;
      }

      const marker = node(
        documentObject,
        "span",
        "ordax-space-icon",
        item.kind === "notifications" ? "N" : "S",
      );
      marker.setAttribute("aria-hidden", "true");
      const copy = node(documentObject, "span");
      copy.append(
        node(documentObject, "strong", "", item.title),
        node(documentObject, "small", "", item.detail),
      );
      const arrow = node(documentObject, "span", "ordax-space-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      button.append(marker, copy, arrow);
      next.append(button);
    }

    if (section) section.replaceWith(next);
    else homePanel.insertBefore(next, space);
    section = next;

    if (focusedKey) {
      const target = Array.from(section.querySelectorAll("[data-home-pending-key]"))
        .find((element) => element.dataset.homePendingKey === focusedKey) ?? null;
      target?.focus({ preventScroll: true });
    }
  };

  const unsubscribeNotifications = notificationsPort?.subscribe((snapshot) => {
    notificationsSnapshot = validateNotificationsSnapshot(snapshot);
    render();
  });
  const unsubscribeSync = syncPort?.subscribe((snapshot) => {
    syncSnapshot = validateSyncRuntimeSnapshot(snapshot);
    render();
  });

  render();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeSync?.();
      unsubscribeNotifications?.();
      section?.remove();
      section = null;
    },
  });
}
