const SURFACE_HEARTBEAT_PATH = "/__ordax/native/surface-heartbeat";
const DEFAULT_INTERVAL_MS = 15000;
const SHA_RE = /^[0-9a-f]{40}$/;

export function nativeSurfaceSourceSha(windowRef = globalThis.window) {
  try {
    const value = new URL(windowRef.location.href).searchParams.get("source") ?? "";
    return SHA_RE.test(value) ? value : "";
  } catch {
    return "";
  }
}

export function createNativeSurfaceHeartbeat(
  windowRef = globalThis.window,
  { intervalMs = DEFAULT_INTERVAL_MS } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Surface heartbeat requires window.fetch");
  }
  const sourceSha = nativeSurfaceSourceSha(windowRef);
  let stopped = false;
  let timer = null;

  const submit = async () => {
    if (stopped || !sourceSha) return;
    try {
      await windowRef.fetch(SURFACE_HEARTBEAT_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSha }),
      });
    } catch {
      // Observation is fail-soft and must never affect the Surface.
    }
  };

  const schedule = () => {
    if (stopped || !sourceSha) return;
    timer = windowRef.setTimeout(() => {
      void submit().finally(schedule);
    }, intervalMs);
  };

  void submit().finally(schedule);

  return Object.freeze({
    sourceSha,
    dispose() {
      stopped = true;
      if (timer !== null) {
        windowRef.clearTimeout(timer);
        timer = null;
      }
    },
  });
}
