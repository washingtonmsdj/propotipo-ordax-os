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

function requireElement(root, selector, label) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Notification center requires ${label}`);
  }
  return element;
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
  const tray = requireElement(root, "[data-notification-tray]", "notification tray trigger");
  const badge = requireElement(root, "[data-notification-unread-count]", "notification unread badge");
  const panel = requireElement(root, "[data-quick-panel='notifications']", "notification quick panel");
  const list = requireElement(root, "[data-notification-list]", "notification list");
  const empty = requireElement(root, "[data-notification-empty]", "notification empty state");
  const persistence = requireElement(root, "[data-notification-persistence]", "notification persistence label");
  const markAllRead = requireElement(root, "[data-notification-mark-all-read]", "mark-all-read action");
  const clearRead = requireElement(root, "[data-notification-clear-read]", "clear-read action");
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
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    tray.dataset.unread = String(unread > 0);
    tray.setAttribute(
      "aria-label",
      unread > 0
        ? `Abrir notificações — ${unread} não ${unread === 1 ? "lida" : "lidas"}`
        : "Abrir notificações — nenhuma nova",
    );
    empty.hidden = snapshot.entries.length !== 0;
    markAllRead.disabled = unread === 0;
    clearRead.disabled = !snapshot.entries.some((entry) => entry.read);
    persistence.textContent = snapshot.persistence === "device"
      ? "Histórico salvo neste dispositivo"
      : "Histórico disponível somente nesta sessão";
  };

  const onClick = (event) => {
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
    },
  });
}
