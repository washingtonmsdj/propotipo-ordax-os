import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import { getFirstPartyApp, isAppAvailable } from "../../apps/catalog.mjs";
import {
  recoverPreferenceSnapshot,
  setPreferenceValue,
} from "../../services/preferences/catalog.mjs";

function freezeWindow(windowState) {
  return Object.freeze({ ...windowState });
}

function freezeWindows(windows) {
  return Object.freeze(windows.map(freezeWindow));
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    capabilityIds: Object.freeze([...state.capabilityIds]),
    windows: freezeWindows(state.windows),
    preferences: Object.freeze({ ...state.preferences }),
  });
}

function activeFallback(windows) {
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (!windows[index].minimized) return windows[index].id;
  }
  return null;
}

function focusWindow(state, windowId) {
  const index = state.windows.findIndex((item) => item.id === windowId);
  if (index < 0) return state;
  const target = { ...state.windows[index], minimized: false };
  const windows = [
    ...state.windows.slice(0, index),
    ...state.windows.slice(index + 1),
    target,
  ];
  return freezeState({ ...state, windows, activeWindowId: windowId, launcherOpen: false });
}

export function createSurfaceState(snapshot, preferenceSeed = {}) {
  const safeSnapshot = validateSurfaceSnapshot(snapshot);
  return freezeState({
    launcherOpen: false,
    connectivity: safeSnapshot.connectivity,
    capabilityIds: safeSnapshot.capabilityIds,
    windows: [],
    activeWindowId: null,
    nextWindowOrdinal: 1,
    preferences: recoverPreferenceSnapshot(preferenceSeed),
  });
}

export function reduceSurfaceState(state, action) {
  switch (action?.type) {
    case "launcher.toggle":
      return freezeState({ ...state, launcherOpen: !state.launcherOpen });
    case "launcher.close":
      return state.launcherOpen ? freezeState({ ...state, launcherOpen: false }) : state;
    case "app.launch": {
      const app = getFirstPartyApp(action.appId);
      if (!isAppAvailable(app, state.capabilityIds)) return state;

      const existing = state.windows.find((item) => item.appId === app.id && app.singleton);
      if (existing) return focusWindow(state, existing.id);

      const windowId = app.singleton ? app.id : `${app.id}:${state.nextWindowOrdinal}`;
      return freezeState({
        ...state,
        launcherOpen: false,
        windows: [
          ...state.windows,
          {
            id: windowId,
            appId: app.id,
            minimized: false,
            maximized: false,
          },
        ],
        activeWindowId: windowId,
        nextWindowOrdinal: app.singleton ? state.nextWindowOrdinal : state.nextWindowOrdinal + 1,
      });
    }
    case "window.focus":
      return focusWindow(state, action.windowId);
    case "window.minimize": {
      const index = state.windows.findIndex((item) => item.id === action.windowId);
      if (index < 0) return state;
      const windows = state.windows.map((item, itemIndex) =>
        itemIndex === index ? { ...item, minimized: true } : item
      );
      return freezeState({
        ...state,
        windows,
        activeWindowId:
          state.activeWindowId === action.windowId ? activeFallback(windows) : state.activeWindowId,
      });
    }
    case "window.maximize": {
      const index = state.windows.findIndex((item) => item.id === action.windowId);
      if (index < 0) return state;
      const updated = {
        ...state.windows[index],
        minimized: false,
        maximized: !state.windows[index].maximized,
      };
      const windows = [
        ...state.windows.slice(0, index),
        ...state.windows.slice(index + 1),
        updated,
      ];
      return freezeState({ ...state, windows, activeWindowId: action.windowId });
    }
    case "window.close": {
      const windows = state.windows.filter((item) => item.id !== action.windowId);
      if (windows.length === state.windows.length) return state;
      return freezeState({
        ...state,
        windows,
        activeWindowId:
          state.activeWindowId === action.windowId ? activeFallback(windows) : state.activeWindowId,
      });
    }
    case "workspace.show-desktop": {
      if (!state.windows.some((item) => !item.minimized) && !state.launcherOpen) return state;
      return freezeState({
        ...state,
        launcherOpen: false,
        windows: state.windows.map((item) => ({ ...item, minimized: true })),
        activeWindowId: null,
      });
    }
    case "preference.set": {
      const preferences = setPreferenceValue(
        state.preferences,
        action.preferenceId,
        action.value
      );
      return preferences === state.preferences
        ? state
        : freezeState({ ...state, preferences });
    }
    case "host.snapshot": {
      const snapshot = validateSurfaceSnapshot(action.snapshot);
      return freezeState({
        ...state,
        connectivity: snapshot.connectivity,
        capabilityIds: snapshot.capabilityIds,
      });
    }
    default:
      return state;
  }
}
