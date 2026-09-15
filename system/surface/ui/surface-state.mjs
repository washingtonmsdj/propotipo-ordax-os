import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";

const VIEWS = new Set(["home", "system"]);

export function createSurfaceState(snapshot) {
  const safeSnapshot = validateSurfaceSnapshot(snapshot);
  return Object.freeze({
    launcherOpen: false,
    activeView: "home",
    connectivity: safeSnapshot.connectivity,
    capabilityIds: safeSnapshot.capabilityIds,
  });
}

export function reduceSurfaceState(state, action) {
  switch (action?.type) {
    case "launcher.toggle":
      return Object.freeze({ ...state, launcherOpen: !state.launcherOpen });
    case "launcher.close":
      return state.launcherOpen ? Object.freeze({ ...state, launcherOpen: false }) : state;
    case "view.open": {
      if (!VIEWS.has(action.view)) {
        return state;
      }
      return Object.freeze({ ...state, activeView: action.view, launcherOpen: false });
    }
    case "host.snapshot": {
      const snapshot = validateSurfaceSnapshot(action.snapshot);
      return Object.freeze({
        ...state,
        connectivity: snapshot.connectivity,
        capabilityIds: snapshot.capabilityIds,
      });
    }
    default:
      return state;
  }
}
