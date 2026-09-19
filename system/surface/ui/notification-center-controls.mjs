import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertNotificationsPort } from "../../contracts/notifications.mjs";

const SOURCE_LABELS = Object.freeze({
  files: "Arquivos",
  settings: "Ajustes",
  account: "Conta",
  system: "Sistema",
  internet: "Internet",
});

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function sourceLabel(sourceId) {
  return SOURCE_LABELS[sourceId] ?? sourceId;
}

function requireHost(root, selector, label) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Notification center requires ${label}`);
  }
  return element;
}

function ensureNotificationMarkup(root) {
  if (root.querySelector("[data-notification-tray], [data-quick-panel='notifications']")) {
    throw new Error("Notification center is already mounted");
  }
  const documentRef = root.ownerDocument;
  const trayHost = requireHost(root, ".ordax-system-tray", "system tray host");
  const panelHost = requireHost(root, "[data-quick-panel-layer]", "quick-panel layer");

  const tray = documentRef.createElement("button");
  tray.type = "button";
  tray.className = "ordax-tray-item ordax-tray-notifications";
  tray.dataset.notificationTray = "";
  tray.dataset.quickPanelToggle = "notifications";
  tray.setAttribute("aria-expanded", "false");
  tray.setAttribute("aria-controls", "ordax-quick-notifications");
  tray.setAttribute("aria-label", "Abrir notificações — nenhuma nova");

  const icon = documentRef.createElement("span");
  icon.className = "ordax-tray-icon ordax-notification-bell";
  icon.setAttribute("aria-hidden", "true");
  const bellShape = documentRef.createElement("span");
  bellShape.className = "ordax-notification-bell-shape";
  icon.append(bellShape);

  const badge = documentRef.createElement("span");
  badge.className = "ordax-notification-badge";
  badge.dataset.notificationUnreadCount = "";
  badge.setAttribute("aria-hidden", "true");
  badge.hidden = true;
  tray.append(icon, badge);
  trayHost.prepend(tray);

  const panel = documentRef.createElement("section");
  panel.id = "ordax-quick-notifications";
  panel.className = "ordax-quick-panel ordax-quick-panel-notifications";
  panel.dataset.quickPanel = "notifications";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "ordax-quick-notifications-title");
  panel.hidden = true;

  const header = documentRef.createElement("header");
  header.className = "ordax-quick-panel-header";
  const headingWrap = documentRef.createElement("div");
  const kicker = documentRef.createElement("span");
  kicker.className = "ordax-quick-kicker";
  kicker.textContent = "Atividade";
  const heading = documentRef.createElement("h2");
  heading.id = "ordax-quick-notifications-title";
  heading.textContent = "Notificações";
  headingWrap.append(kicker, heading);
  const close = documentRef.createElement("button");
  close.type = "button";
  close.className = "ordax-quick-close";
  close.dataset.quickPanelClose = "";
  close.setAttribute("aria-label", "Fechar notificações");
  close.textContent = "×";
  header.append(headingWrap, close);

  const empty = documentRef.createElement("p");
  empty.className = "ordax-quick-empty ordax-notification-empty";
  empty.dataset.notificationEmpty = "";
  empty.textContent = "Nenhuma notificação registrada nesta sessão.";

  const list = documentRef.createElement("div");
  list.className = "ordax-notification-list";
  list.dataset.notificationList = "";

  const footer = documentRef.createElement("footer");
  footer.className = "ordax-notification-footer";
  const persistence = documentRef.createElement("span");
  persistence.className = "ordax-notification-persistence";
  persistence.dataset.notificationPersistence = "";
  const actions = documentRef.createElement("div");
  actions.className = "ordax-notification-footer-actions";
  const doNotDisturb = documentRef.createElement("button");
  doNotDisturb.type = "button";
  doNotDisturb.className = "ordax-notification-action";
  doNotDisturb.dataset.notificationDoNotDisturb = "";
  doNotDisturb.setAttribute("aria-pressed", "false");
  const markAllRead = documentRef.createElement("button");
  markAllRead.type = "button";
  markAllRead.className = "ordax-notification-action";
  markAllRead.dataset.notificationMarkAllRead = "";
  markAllRead.textContent = "Marcar lidas";
  const clearRead = documentRef.createElement("button");
  clearRead.type = "button";
  clearRead.className = "ordax-notification-action";
  clearRead.dataset.notificationClearRead = "";
  clearRead.textContent = "Limpar lidas";
  actions.append(doNotDisturb, markAllRead, clearRead);
  footer.append(persistence, actions);

  panel.append(header, empty, list, footer);
  panelHost.prepend(panel);

  return Object.freeze({
    tray,
    badge,
    panel,
    list,
    empty,
    persistence,
    doNotDisturb,
    markAllRead,
    clearRead,
    remove() {
      panel.remove();
      tray.remove();
    },
  });
}

function buildEntryNode(documentRef, entry) {
  const article = documentRef.createElement("article");
  article.className = "ordax-notification-entry";
  article.dataset.notificationId = entry.id;

  const header = documentRef.createElement("div");
  header.className = "ordax-notification-entry-header";
  const source = documentRef.createElement("span");
  source.dataset.notificationSource = "";
  source.className = "ordax-notification-source";
  const time = documentRef.createElement("time");
  time.dataset.notificationTime = "";
  time.className = "ordax-notification-time";
  header.append(source, time);

  const title = documentRef.createElement("strong");
  title.dataset.notificationTitle = "";
  title.className = "ordax-notification-title";
  const message = documentRef.createElement("p");
  message.dataset.notificationMessage = "";
  message.className = "ordax-notification-message";

  const actions = documentRef.createElement("div");
  actions.className = "ordax-notification-actions";
  const open = documentRef.createElement("button");
  open.type = "button";
  open.className = "ordax-notification-action";
  open.dataset.notificationOpen = entry.id;
  open.textContent = "Abrir";
  const dismiss = documentRef.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ordax-notification-action";
  dismiss.dataset.notificationDismiss = entry.id;
  dismiss.textContent = "Dispensar";
  actions.append(open, dismiss);
  article.append(header, title, message, actions);
  return article;
}

function updateEntryNode(node, entry) {
  node.dataset.level = entry.level;
  node.dataset.read = String(entry.read);
  const source = node.querySelector("[data-notification-source]");
  const time = node.querySelector("[data-notification-time]");
  const title = node.querySelector("[data-notification-title]");
  const message = node.querySelector("[data-notification-message]");
  const open = node.querySelector("[data-notification-open]");
  source.textContent = sourceLabel(entry.sourceId);
  time.dateTime = new Date(entry.createdAt).toISOString();
  time.textContent = formatTimestamp(entry.createdAt);
  title.textContent = entry.title;
  message.textContent = entry.message;
  if (entry.destination) {
    open.hidden = false;
    open.dataset.notificationOpen = entry.id;
    open.setAttribute("aria-label", `Abrir destino de ${entry.title}`);
  } else {
    open.hidden = true;
  }
}

export function mountNotificationCenterControls(root, notifications, appActivation) {
  if (!(root instanceof Element)) {
    throw new TypeError("Notification center requires a Surface root Element");
  }
  const center = assertNotificationsPort(notifications);
  const activation = assertAppActivationPort(appActivation);
  const markup = ensureNotificationMarkup(root);
  const {
    tray,
    badge,
    panel,
    list,
    empty,
    persistence,
    doNotDisturb,
    markAllRead,
    clearRead,
  } = markup;
  const entryNodes = new Map();
  let snapshot = center.getSnapshot();

  const render = (nextSnapshot) => {
    snapshot = nextSnapshot;
    const visibleIds = new Set(snapshot.entries.map((entry) => entry.id));
    for (const [id, node] of entryNodes) {
      if (visibleIds.has(id)) continue;
      node.remove();
      entryNodes.delete(id);
    }

    let previousNode = null;
    for (const entry of snapshot.entries) {
      let node = entryNodes.get(entry.id);
      if (!node) {
        node = buildEntryNode(root.ownerDocument, entry);
        entryNodes.set(entry.id, node);
      }
      updateEntryNode(node, entry);
      const expectedBefore = previousNode === null ? list.firstElementChild : previousNode.nextElementSibling;
      if (node !== expectedBefore) list.insertBefore(node, expectedBefore);
      previousNode = node;
    }

    const unread = snapshot.unreadCount;
    const attentionVisible = unread > 0 && !snapshot.doNotDisturb;
    badge.hidden = !attentionVisible;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    tray.dataset.unread = String(attentionVisible);
    tray.dataset.doNotDisturb = String(snapshot.doNotDisturb);
    tray.setAttribute(
      "aria-label",
      snapshot.doNotDisturb
        ? `Abrir notificações — Não perturbe ativo; ${unread} não ${unread === 1 ? "lida" : "lidas"}`
        : unread > 0
          ? `Abrir notificações — ${unread} não ${unread === 1 ? "lida" : "lidas"}`
          : "Abrir notificações — nenhuma nova",
    );
    doNotDisturb.setAttribute("aria-pressed", String(snapshot.doNotDisturb));
    doNotDisturb.textContent = snapshot.doNotDisturb
      ? "Desativar Não perturbe"
      : "Ativar Não perturbe";
    empty.hidden = snapshot.entries.length !== 0;
    markAllRead.disabled = unread === 0;
    clearRead.disabled = !snapshot.entries.some((entry) => entry.read);
    const historyPersistence = snapshot.persistence === "device"
      ? "Histórico salvo neste dispositivo"
      : "Histórico disponível somente nesta sessão";
    const policyPersistence = snapshot.policyPersistence === "device"
      ? "Não perturbe salvo neste dispositivo"
      : "Não perturbe vale somente nesta sessão";
    persistence.textContent = `${historyPersistence} · ${policyPersistence}`;
  };

  const onClick = (event) => {
    const dnd = event.target.closest("[data-notification-do-not-disturb]");
    if (dnd && panel.contains(dnd)) {
      center.setDoNotDisturb(!snapshot.doNotDisturb);
      return;
    }
    const markAll = event.target.closest("[data-notification-mark-all-read]");
    if (markAll && panel.contains(markAll)) {
      center.markAllRead();
      return;
    }
    const clear = event.target.closest("[data-notification-clear-read]");
    if (clear && panel.contains(clear)) {
      center.clearRead();
      return;
    }
    const dismiss = event.target.closest("[data-notification-dismiss]");
    if (dismiss && panel.contains(dismiss)) {
      center.dismiss(dismiss.dataset.notificationDismiss);
      return;
    }
    const open = event.target.closest("[data-notification-open]");
    if (open && panel.contains(open)) {
      const entry = snapshot.entries.find((candidate) => candidate.id === open.dataset.notificationOpen);
      if (!entry?.destination) return;
      center.markRead(entry.id);
      activation.publish(entry.destination);
      panel.querySelector("[data-quick-panel-close]")?.click();
    }
  };

  const onPanelOpen = () => {
    if (center.getSnapshot().unreadCount > 0) center.markAllRead();
  };

  const unsubscribe = center.subscribe(render);
  panel.addEventListener("click", onClick);
  panel.addEventListener("ordax:quick-panel-open", onPanelOpen);
  render(snapshot);

  return Object.freeze({
    destroy() {
      unsubscribe();
      panel.removeEventListener("click", onClick);
      panel.removeEventListener("ordax:quick-panel-open", onPanelOpen);
      markup.remove();
    },
  });
}
