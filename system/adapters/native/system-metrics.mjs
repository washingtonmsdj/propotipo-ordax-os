import {
  SYSTEM_METRICS_SCHEMA,
  assertSystemMetricsPort,
  validateSystemMetricsSnapshot,
} from "../../contracts/system-metrics.mjs";

const METRICS_ENDPOINT = "/__ordax/native/metrics";

export async function createNativeSystemMetrics(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native system metrics adapter requires window.fetch");
  }

  const port = {
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      const response = await windowRef.fetch(METRICS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Native system metrics request failed: ${response.status}`);
      }
      return validateSystemMetricsSnapshot(await response.json());
    },
  };

  assertSystemMetricsPort(port);
  await port.read();
  return Object.freeze(port);
}
