import { assertBrowserSessionPort } from "../../../contracts/browser-session.mjs";

const INTERNET_WINDOW_SELECTOR = '[data-window-id="internet"]';
const INTERNET_EXTENSION_SELECTOR = '[data-app-extension="internet-browser"]';
const MAX_UI_TABS = 16;

export function mountInternetBrowserShortcuts(root, browserSession) {
  if (!(root instanceof Element)) {
    throw new TypeError("Internet shortcut controls require a Surface root Element");
  }
  const port = assertBrowserSessionPort(browserSession);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  let nextTabOrdinal = 1;
  let destroyed = false;

  const findSlot = () => root.querySelector(
    `${INTERNET_WINDOW_SELECTOR} ${INTERNET_EXTENSION_SELECTOR}`,
  );

  const allocateTabId = (snapshot) => {
    while (snapshot.tabs.some((tab) => tab.id === `tab-${nextTabOrdinal}`)) {
      nextTabOrdinal += 1;
    }
    return `tab-${nextTabOrdinal++}`;
  };

  const activeTab = (snapshot) => (
    snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null
  );

  const focusAddress = ({ clear = false } = {}) => {
    const input = findSlot()?.querySelector("[data-browser-address]") ?? null;
    if (!input) return false;
    if (clear) input.value = "";
    input.focus({ preventScroll: true });
    if (!clear) input.select();
    return true;
  };

  const onShortcut = (action) => {
    if (destroyed || !findSlot()) return;
    const snapshot = port.getSnapshot();
    if (!snapshot.supported) return;
    const tab = activeTab(snapshot);

    if (action === "focus-address") {
      focusAddress();
      return;
    }
    if (action === "new-tab") {
      if (snapshot.tabs.length >= MAX_UI_TABS) return;
      port.openTab(allocateTabId(snapshot), "");
      windowObject.requestAnimationFrame(() => focusAddress({ clear: true }));
      return;
    }
    if (!tab) return;
    if (action === "close-tab") {
      port.closeTab(tab.id);
      return;
    }
    if (action === "reload" && tab.url) {
      port.reload(tab.id);
      return;
    }
    if (action === "back" && tab.canGoBack) {
      port.goBack(tab.id);
      return;
    }
    if (action === "forward" && tab.canGoForward) {
      port.goForward(tab.id);
    }
  };

  const unsubscribe = port.subscribeShortcuts(onShortcut);

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
    },
  });
}
