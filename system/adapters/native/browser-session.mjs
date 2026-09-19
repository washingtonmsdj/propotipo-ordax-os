import {
  BROWSER_SESSION_SCHEMA,
  createUnavailableBrowserSession,
  validateBrowserSnapshot,
} from "../../contracts/browser-session.mjs";

const EVENT_NAME = "ordax-browser-host";
const HANDLER_NAME = "ordaxBrowser";
const SHORTCUT_ACTIONS = new Set([
  "focus-address",
  "new-tab",
  "close-tab",
  "reload",
  "back",
  "forward",
]);

function nativeBridge(windowRef) {
  return windowRef?.webkit?.messageHandlers?.[HANDLER_NAME] ?? null;
}

export function createNativeBrowserSession(windowRef = globalThis.window) {
  const bridge = nativeBridge(windowRef);
  if (!bridge || typeof bridge.postMessage !== "function") {
    return createUnavailableBrowserSession("O host WebKit do OrdaX não expôs o engine de navegação isolado.");
  }

  let snapshot = validateBrowserSnapshot({
    supported: true,
    reason: "",
    activeTabId: null,
    tabs: [],
  });
  const listeners = new Set();
  const shortcutListeners = new Set();

  const post = (command) => {
    bridge.postMessage(JSON.stringify(command));
    return true;
  };
  const notify = () => {
    for (const listener of [...listeners]) listener(snapshot);
  };
  const notifyShortcut = (action) => {
    for (const listener of [...shortcutListeners]) listener(action);
  };
  const onHostEvent = (event) => {
    const payload = event?.detail;
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "shortcut") {
      if (SHORTCUT_ACTIONS.has(payload.action)) notifyShortcut(payload.action);
      return;
    }
    if (payload.type !== "snapshot") return;
    try {
      snapshot = validateBrowserSnapshot(payload.snapshot);
      notify();
    } catch (error) {
      console.warn("OrdaX browser host emitted an invalid snapshot", error);
    }
  };
  windowRef.addEventListener(EVENT_NAME, onHostEvent);
  post({ type: "snapshot.request" });

  return Object.freeze({
    schema: BROWSER_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Browser listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeShortcuts(listener) {
      if (typeof listener !== "function") throw new TypeError("Browser shortcut listener must be a function");
      shortcutListeners.add(listener);
      return () => shortcutListeners.delete(listener);
    },
    openTab(tabId, url = "") {
      return post({ type: "tab.open", tabId, url });
    },
    closeTab(tabId) {
      return post({ type: "tab.close", tabId });
    },
    activateTab(tabId) {
      return post({ type: "tab.activate", tabId });
    },
    navigate(tabId, url) {
      return post({ type: "tab.navigate", tabId, url });
    },
    goBack(tabId) {
      return post({ type: "tab.back", tabId });
    },
    goForward(tabId) {
      return post({ type: "tab.forward", tabId });
    },
    reload(tabId) {
      return post({ type: "tab.reload", tabId });
    },
    setViewport(viewport) {
      return post({ type: "viewport.set", viewport });
    },
    dispose() {
      listeners.clear();
      shortcutListeners.clear();
      windowRef.removeEventListener(EVENT_NAME, onHostEvent);
      post({ type: "viewport.set", viewport: { visible: false, x: 0, y: 0, width: 0, height: 0 } });
    },
  });
}