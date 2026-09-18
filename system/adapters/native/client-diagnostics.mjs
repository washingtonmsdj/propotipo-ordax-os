const SESSION_ENDPOINT = "/__ordax/native/session";
const DIAGNOSTIC_ENDPOINT = "/__ordax/native/client-diagnostic";
const TOKEN_HEADER = "X-OrdaX-Diagnostic-Token";

const STAGE_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SOURCE_RE = /^[A-Za-z0-9_.-]+\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$/;

function localSourceFromError(error) {
  const stack = typeof error?.stack === "string" ? error.stack : "";
  for (const line of stack.split("\n").slice(0, 12)) {
    const match = line.match(/([A-Za-z0-9_.-]+\.mjs):(\d{1,6}):(\d{1,6})/);
    if (!match) continue;
    const source = `${match[1]}:${match[2]}:${match[3]}`;
    if (SOURCE_RE.test(source)) return source;
  }
  return "";
}

export function sanitizeClientDiagnostic(stage, error) {
  const safeStage = typeof stage === "string" && STAGE_RE.test(stage)
    ? stage
    : "surface";
  const candidateName = typeof error?.name === "string" ? error.name : "Error";
  const errorName = ERROR_NAME_RE.test(candidateName) ? candidateName : "Error";
  return Object.freeze({
    stage: safeStage,
    errorName,
    source: localSourceFromError(error),
  });
}

export async function createNativeClientDiagnostics(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native client diagnostics require window.fetch");
  }

  const response = await windowRef.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native diagnostic session failed: ${response.status}`);
  const session = await response.json();
  if (typeof session.diagnosticToken !== "string" || session.diagnosticToken.length < 16) {
    throw new Error("Native diagnostic token is unavailable");
  }

  const report = async (sourceSha, stage, error) => {
    const diagnostic = sanitizeClientDiagnostic(stage, error);
    if (typeof sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(sourceSha)) return false;
    try {
      const result = await windowRef.fetch(DIAGNOSTIC_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [TOKEN_HEADER]: session.diagnosticToken,
        },
        body: JSON.stringify({ sourceSha, ...diagnostic }),
      });
      return result.ok;
    } catch {
      return false;
    }
  };

  return Object.freeze({ report });
}

export function renderedSourceSha(windowRef = globalThis.window) {
  try {
    const value = new URL(windowRef.location.href).searchParams.get("source") ?? "";
    return /^[0-9a-f]{40}$/.test(value) ? value : "";
  } catch {
    return "";
  }
}
