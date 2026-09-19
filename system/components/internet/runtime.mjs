import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { createBrowserFavoritesRuntime } from "../../services/internet/favorites.mjs";
import { createBrowserHistoryRuntime } from "../../services/internet/history.mjs";
import { createBrowserHistoryBridge } from "../../services/internet/history-bridge.mjs";
import { mountInternetBrowserControls } from "../../surface/ui/internet-browser-controls.mjs";
import { mountInternetBrowserShortcuts } from "../../surface/ui/internet-browser-shortcuts.mjs";

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "internet",
  version: "0.2.0",
  mount({
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
      },
    });
  },
});
