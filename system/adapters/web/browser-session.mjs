import { createUnavailableBrowserSession } from "../../contracts/browser-session.mjs";

export function createWebBrowserSession() {
  return createUnavailableBrowserSession(
    "O modo Web não incorpora sites arbitrários dentro da Surface. Use OrdaX Desktop, USB ou Native para navegação integrada.",
  );
}
