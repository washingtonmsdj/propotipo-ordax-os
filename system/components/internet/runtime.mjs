import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { createBrowserFavoritesRuntime } from "../../services/internet/favorites.mjs";
import { createBrowserHistoryRuntime } from "../../services/internet/history.mjs";
import { createBrowserHistoryBridge } from "../../services/internet/history-bridge.mjs";
import { mountInternetBrowserControls } from "../../surface/ui/internet-browser-controls.mjs";
import { mountInternetBrowserShortcuts } from "../../surface/ui/internet-browser-shortcuts.mjs";

const INTERNET_STYLESHEET_URL = new URL("./internet.css", import.meta.url).href;
const INTERNET_STYLE_SELECTOR = 'link[data-ordax-component-style="internet"]';

async function mountInternetStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Internet runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(INTERNET_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== INTERNET_STYLESHEET_URL) {
      throw new TypeError("Internet component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = INTERNET_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "internet";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Internet component stylesheet failed to load")),
      { once: true },
    );
  });

  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "internet",
  version: "0.3.0",
  async mount({
    root,
    browserSession,
    surfaceLifecycle,
    projects = null,
    projectReferences = null,
    createFavoritesStore = null,
    createHistoryStore = null,
    enableShortcuts = true,
    reportDiagnostic = null,
  } = {}) {
    if (createFavoritesStore !== null && typeof createFavoritesStore !== "function") {
      throw new TypeError("Internet createFavoritesStore must be a function or null");
    }
    if (createHistoryStore !== null && typeof createHistoryStore !== "function") {
      throw new TypeError("Internet createHistoryStore must be a function or null");
    }
    const releaseStyles = await mountInternetStyles(root);
    try {
      const favoritesStore = createFavoritesStore?.() ?? null;
      const historyStore = createHistoryStore?.() ?? null;
      const favorites = favoritesStore === null
        ? null
        : createBrowserFavoritesRuntime({ store: favoritesStore });
      const history = historyStore === null
        ? null
        : createBrowserHistoryRuntime({ store: historyStore });
      const historyBridge = history === null
        ? null
        : createBrowserHistoryBridge(browserSession, history, {
            onError(error) {
              reportDiagnostic?.("internet-history", error);
            },
          });
      const controls = mountInternetBrowserControls(
        root,
        browserSession,
        surfaceLifecycle,
        { projects, projectReferences, favorites, history },
      );
      const shortcuts = enableShortcuts
        ? mountInternetBrowserShortcuts(root, browserSession)
        : null;
      let destroyed = false;

      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          shortcuts?.destroy();
          controls.destroy();
          historyBridge?.destroy();
          history?.destroy();
          favorites?.destroy();
          releaseStyles();
        },
      });
    } catch (error) {
      releaseStyles();
      throw error;
    }
  },
});
