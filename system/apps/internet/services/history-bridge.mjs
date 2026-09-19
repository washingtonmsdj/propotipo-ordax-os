import { assertBrowserHistoryPort, validateBrowserHistoryUrl } from "../../../contracts/browser-history.mjs";
import { assertBrowserSessionPort } from "../../../contracts/browser-session.mjs";

function publicHistoryUrl(value) {
  if (!value) return null;
  try {
    return validateBrowserHistoryUrl(value);
  } catch {
    return null;
  }
}

export function createBrowserHistoryBridge(
  browserSession,
  browserHistory,
  { onError = null } = {},
) {
  const session = assertBrowserSessionPort(browserSession);
  const history = assertBrowserHistoryPort(browserHistory);
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Browser history bridge onError must be a function");
  }

  const initial = session.getSnapshot();
  const completedByTab = new Map(
    initial.tabs.map((tab) => [tab.id, publicHistoryUrl(tab.url) ?? ""]),
  );
  let destroyed = false;

  const report = (error) => {
    if (onError) onError(error);
  };

  const observe = (snapshot) => {
    if (destroyed) return;
    const liveIds = new Set(snapshot.tabs.map((tab) => tab.id));
    for (const id of [...completedByTab.keys()]) {
      if (!liveIds.has(id)) completedByTab.delete(id);
    }

    for (const tab of snapshot.tabs) {
      const url = publicHistoryUrl(tab.url);
      if (!completedByTab.has(tab.id)) {
        completedByTab.set(tab.id, "");
      }
      if (tab.loading || !url) continue;

      const previous = completedByTab.get(tab.id) ?? "";
      if (url === previous) continue;
      completedByTab.set(tab.id, url);
      try {
        history.record({ url, title: tab.title });
      } catch (error) {
        report(error);
      }
    }
  };

  const unsubscribe = session.subscribe(observe);
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      completedByTab.clear();
    },
  });
}
