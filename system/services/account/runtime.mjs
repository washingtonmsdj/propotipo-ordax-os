import { validateIdentityActionsSnapshot } from "../../contracts/identity-actions.mjs";
import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";

export function validateAccountRuntime(surfaceValue, identityValue, actionsValue = { supportedActions: [] }) {
  const surface = validateSurfaceSnapshot(surfaceValue);
  const identity = validateIdentitySessionSnapshot(identityValue);
  const actions = validateIdentityActionsSnapshot(actionsValue);
  const capabilities = new Set(surface.capabilityIds);
  const identityAvailable = capabilities.has("account.identity");
  const syncAvailable = capabilities.has("sync.safe-state");
  const canSignIn = actions.supportedActions.includes("sign-in");
  const canSignOut = actions.supportedActions.includes("sign-out");

  if (syncAvailable && !identityAvailable) {
    throw new TypeError("sync.safe-state requires account.identity in the same runtime snapshot");
  }
  if (identity.state === "unavailable" && identityAvailable) {
    throw new TypeError("account.identity cannot be advertised while the identity session port is unavailable");
  }
  if (identity.state !== "unavailable" && !identityAvailable) {
    throw new TypeError("available identity session requires account.identity capability");
  }
  if (identity.state === "unavailable" && actions.supportedActions.length > 0) {
    throw new TypeError("identity actions cannot be advertised while identity is unavailable");
  }
  if (identity.state === "signed-out" && canSignOut) {
    throw new TypeError("sign-out action cannot be advertised for a signed-out session");
  }
  if (identity.state === "signed-in" && canSignIn) {
    throw new TypeError("sign-in action cannot be advertised for a signed-in session");
  }

  return Object.freeze({ surface, identity, actions });
}
