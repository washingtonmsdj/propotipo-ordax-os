import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { INTERNET_VERSION } from "./version.mjs";
import { createBrowserFavoritesRuntime } from "./services/favorites.mjs";
import { createBrowserHistoryRuntime } from "./services/history.mjs";
import { createBrowserHistoryBridge } from "./services/history-bridge.mjs";
import { mountInternetBrowserControls } from "./ui/browser-controls.mjs";
import { mountInternetBrowserShortcuts } from "./ui/browser-shortcuts.mjs";

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
  version: INTERNET_VERSION,
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
    let favorites = null;
    let history = null;
    let historyBridge = null;
    let controls = null;
    let shortcuts = null;

    const cleanup = () => {
      shortcuts?.destroy();
      controls?.destroy();
      historyBridge?.destroy();
      history?.destroy();
      favorites?.destroy();
      releaseStyles();
    };

    try {
      const favoritesStore = createFavoritesStore?.() ?? null;
      const historyStore = createHistoryStore?.() ?? null;
      favorites = favoritesStore === null
        ? null
        : createBrowserFavoritesRuntime({ store: favoritesStore });
      history = historyStore === null
        ? null
        : createBrowserHistoryRuntime({ store: historyStore });
      historyBridge = history === null
        ? null
        : createBrowserHistoryBridge(browserSession, history, {
            onError(error) {
              reportDiagnostic?.("internet-history", error);
            },
          });
      controls = mountInternetBrowserControls(
        root,
        browserSession,
        surfaceLifecycle,
        { projects, projectReferences, favorites, history },
      );
      shortcuts = enableShortcuts
        ? mountInternetBrowserShortcuts(root, browserSession)
        : null;
      let destroyed = false;

      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          cleanup();
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  },
});
