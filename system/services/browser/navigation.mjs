export const BROWSER_NAVIGATION_SCHEMA = "ordax.browser-navigation/1";
export const MAX_BROWSER_HISTORY = 64;
export const MAX_BROWSER_URL_LENGTH = 4096;

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeBrowserAddress(value) {
  if (typeof value !== "string") {
    throw new TypeError("Browser address must be a string");
  }
  const candidate = value.trim();
  if (
    !candidate
    || candidate.length > MAX_BROWSER_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    throw new TypeError("Browser address is invalid");
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
  const source = hasScheme ? candidate : `https:${"//"}${candidate}`;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("Browser address is invalid");
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) {
    throw new TypeError("Browser address must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("Browser address must not contain URL credentials");
  }
  if (!parsed.hostname) {
    throw new TypeError("Browser address requires a host");
  }
  if (parsed.href.length > MAX_BROWSER_URL_LENGTH) {
    throw new TypeError("Browser address is too long");
  }
  return parsed.href;
}

function tryNormalize(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return normalizeBrowserAddress(String(value));
  } catch {
    return null;
  }
}

function snapshot(entries, index, revision) {
  const currentUrl = index >= 0 ? entries[index] : null;
  return Object.freeze({
    schema: BROWSER_NAVIGATION_SCHEMA,
    entries: Object.freeze([...entries]),
    index,
    currentUrl,
    canGoBack: index > 0,
    canGoForward: index >= 0 && index < entries.length - 1,
    revision,
  });
}

export function createBrowserNavigation({ initialUrl = null } = {}) {
  const initial = tryNormalize(initialUrl);
  let entries = initial ? [initial] : [];
  let index = initial ? 0 : -1;
  let revision = 0;
  const listeners = new Set();

  const emit = () => {
    const state = snapshot(entries, index, revision);
    for (const listener of [...listeners]) listener(state);
    return state;
  };

  const runtime = {
    schema: BROWSER_NAVIGATION_SCHEMA,
    getSnapshot() {
      return snapshot(entries, index, revision);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Browser navigation listener must be a function");
      }
      listeners.add(listener);
      listener(runtime.getSnapshot());
      return () => listeners.delete(listener);
    },
    navigate(value) {
      const next = normalizeBrowserAddress(value);
      if (index >= 0 && entries[index] === next) {
        revision += 1;
        return emit();
      }
      const forwardTrimmed = index >= 0 ? entries.slice(0, index + 1) : [];
      forwardTrimmed.push(next);
      if (forwardTrimmed.length > MAX_BROWSER_HISTORY) {
        forwardTrimmed.splice(0, forwardTrimmed.length - MAX_BROWSER_HISTORY);
      }
      entries = forwardTrimmed;
      index = entries.length - 1;
      revision += 1;
      return emit();
    },
    back() {
      if (index <= 0) return runtime.getSnapshot();
      index -= 1;
      revision += 1;
      return emit();
    },
    forward() {
      if (index < 0 || index >= entries.length - 1) return runtime.getSnapshot();
      index += 1;
      revision += 1;
      return emit();
    },
    reload() {
      if (index < 0) return runtime.getSnapshot();
      revision += 1;
      return emit();
    },
    reset() {
      if (entries.length === 0 && index === -1) return runtime.getSnapshot();
      entries = [];
      index = -1;
      revision += 1;
      return emit();
    },
    destroy() {
      listeners.clear();
    },
  };

  return Object.freeze(runtime);
}

export function assertBrowserNavigation(runtime) {
  if (!runtime || runtime.schema !== BROWSER_NAVIGATION_SCHEMA) {
    throw new TypeError("A compatible browser navigation runtime is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "navigate",
    "back",
    "forward",
    "reload",
    "reset",
    "destroy",
  ]) {
    if (typeof runtime[method] !== "function") {
      throw new TypeError(`Browser navigation runtime must implement ${method}()`);
    }
  }
  return runtime;
}
