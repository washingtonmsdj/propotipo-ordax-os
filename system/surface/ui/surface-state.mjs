import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import {
  MAX_WORKSPACE_AREAS,
  validateWorkspaceRecord,
  validateWorkspaceTarget,
} from "../../contracts/workspace-store.mjs";
import { getFirstPartyApp, isAppAvailable } from "../../apps/catalog.mjs";
import {
  recoverPreferenceSnapshot,
  setPreferenceValue,
} from "../../services/preferences/catalog.mjs";

function freezeWindow(windowState) {
  return Object.freeze({ ...windowState });
}

function freezeArea(area) {
  return Object.freeze({
    ...area,
    windows: Object.freeze(area.windows.map(freezeWindow)),
  });
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    capabilityIds: Object.freeze([...state.capabilityIds]),
    areas: Object.freeze(state.areas.map(freezeArea)),
    preferences: Object.freeze({ ...state.preferences }),
  });
}

function activeFallback(windows) {
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (!windows[index].minimized) return windows[index].id;
  }
  return null;
}

export function getActiveArea(state) {
  const area = state.areas.find((item) => item.id === state.activeAreaId);
  if (!area) throw new TypeError("Surface state active area is missing");
  return area;
}

export function getActiveWindows(state) {
  return getActiveArea(state).windows;
}

export function getActiveWindowId(state) {
  return getActiveArea(state).activeWindowId;
}

function replaceArea(state, areaId, nextArea, extra = {}) {
  const index = state.areas.findIndex((item) => item.id === areaId);
  if (index < 0) return state;
  const areas = state.areas.map((item, itemIndex) => itemIndex === index ? nextArea : item);
  return freezeState({ ...state, ...extra, areas });
}

function updateActiveArea(state, updater, extra = {}) {
  const area = getActiveArea(state);
  const nextArea = updater(area);
  if (nextArea === area && Object.keys(extra).length === 0) return state;
  return replaceArea(state, area.id, nextArea, extra);
}

function focusWindow(state, windowId) {
  const area = getActiveArea(state);
  const index = area.windows.findIndex((item) => item.id === windowId);
  if (index < 0) return state;
  const current = area.windows[index];
  if (
    area.activeWindowId === windowId &&
    !current.minimized &&
    index === area.windows.length - 1 &&
    !state.launcherOpen
  ) {
    return state;
  }

  return updateActiveArea(state, (area) => {
    const index = area.windows.findIndex((item) => item.id === windowId);
    if (index < 0) return area;
    const target = { ...area.windows[index], minimized: false };
    const windows = [
      ...area.windows.slice(0, index),
      ...area.windows.slice(index + 1),
      target,
    ];
    return { ...area, windows, activeWindowId: windowId };
  }, { launcherOpen: false });
}

function validateWindowCoordinate(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`Window ${name} must be a finite non-negative number`);
  }
  return Math.round(value);
}

function recoverWorkspaceWindows(workspace, capabilityIds) {
  const windows = [];
  const singletonApps = new Set();
  for (const windowState of workspace.windows) {
    const app = getFirstPartyApp(windowState.appId);
    if (!isAppAvailable(app, capabilityIds)) continue;
    if (app.singleton) {
      if (windowState.id !== app.id || singletonApps.has(app.id)) continue;
      singletonApps.add(app.id);
    } else if (!windowState.id.startsWith(`${app.id}:`)) {
      continue;
    }
    windows.push({ ...windowState });
  }
  return windows;
}

function recoverArea(area, capabilityIds) {
  const windows = recoverWorkspaceWindows(area, capabilityIds);
  const highestOrdinal = windows.reduce(
    (highest, windowState) => Math.max(highest, windowState.placementOrdinal),
    0,
  );
  const persistedActive = windows.find(
    (windowState) => windowState.id === area.activeWindowId && !windowState.minimized,
  );
  return {
    id: area.id,
    ordinal: area.ordinal,
    windows,
    activeWindowId: persistedActive?.id ?? activeFallback(windows),
    nextWindowOrdinal: Math.max(area.nextWindowOrdinal, highestOrdinal + 1),
  };
}

export function createWorkspaceSnapshot(state) {
  return validateWorkspaceRecord({
    activeAreaId: state.activeAreaId,
    nextAreaOrdinal: state.nextAreaOrdinal,
    areas: state.areas.map((area) => ({
      id: area.id,
      ordinal: area.ordinal,
      windows: area.windows.map((windowState) => ({
        id: windowState.id,
        appId: windowState.appId,
        minimized: windowState.minimized,
        maximized: windowState.maximized,
        placementOrdinal: windowState.placementOrdinal,
        positionX: windowState.positionX,
        positionY: windowState.positionY,
        target: windowState.target,
      })),
      activeWindowId: area.activeWindowId,
      nextWindowOrdinal: area.nextWindowOrdinal,
    })),
  });
}

export function createSurfaceState(snapshot, preferenceSeed = {}, workspaceSeed = null) {
  const safeSnapshot = validateSurfaceSnapshot(snapshot);
  const workspace = validateWorkspaceRecord(workspaceSeed);
  return freezeState({
    launcherOpen: false,
    connectivity: safeSnapshot.connectivity,
    capabilityIds: safeSnapshot.capabilityIds,
    activeAreaId: workspace.activeAreaId,
    nextAreaOrdinal: workspace.nextAreaOrdinal,
    areas: workspace.areas.map((area) => recoverArea(area, safeSnapshot.capabilityIds)),
    preferences: recoverPreferenceSnapshot(preferenceSeed),
  });
}

export function reduceSurfaceState(state, action) {
  switch (action?.type) {
    case "launcher.toggle":
      return freezeState({ ...state, launcherOpen: !state.launcherOpen });
    case "launcher.close":
      return state.launcherOpen ? freezeState({ ...state, launcherOpen: false }) : state;
    case "area.switch": {
      if (action.areaId === state.activeAreaId) {
        return state.launcherOpen ? freezeState({ ...state, launcherOpen: false }) : state;
      }
      if (!state.areas.some((area) => area.id === action.areaId)) return state;
      return freezeState({ ...state, activeAreaId: action.areaId, launcherOpen: false });
    }
    case "area.create": {
      if (state.areas.length >= MAX_WORKSPACE_AREAS) return state;
      const ordinal = state.nextAreaOrdinal;
      const area = {
        id: `area-${ordinal}`,
        ordinal,
        windows: [],
        activeWindowId: null,
        nextWindowOrdinal: 1,
      };
      return freezeState({
        ...state,
        launcherOpen: false,
        activeAreaId: area.id,
        nextAreaOrdinal: ordinal + 1,
        areas: [...state.areas, area],
      });
    }
    case "app.launch": {
      const app = getFirstPartyApp(action.appId);
      if (!isAppAvailable(app, state.capabilityIds)) return state;
      const hasTarget = Object.prototype.hasOwnProperty.call(action, "target");
      const target = hasTarget ? validateWorkspaceTarget(action.target) : undefined;
      const area = getActiveArea(state);
      const existing = area.windows.find((item) => item.appId === app.id && app.singleton);
      if (existing) {
        let nextState = state;
        if (hasTarget && existing.target !== target) {
          nextState = updateActiveArea(state, (current) => ({
            ...current,
            windows: current.windows.map((item) =>
              item.id === existing.id ? { ...item, target } : item
            ),
          }));
        }
        return focusWindow(nextState, existing.id);
      }

      const ordinal = area.nextWindowOrdinal;
      const windowId = app.singleton ? app.id : `${app.id}:${ordinal}`;
      return updateActiveArea(state, (current) => ({
        ...current,
        windows: [
          ...current.windows,
          {
            id: windowId,
            appId: app.id,
            minimized: false,
            maximized: false,
            placementOrdinal: ordinal,
            positionX: null,
            positionY: null,
            target: target ?? null,
          },
        ],
        activeWindowId: windowId,
        nextWindowOrdinal: ordinal + 1,
      }), { launcherOpen: false });
    }
    case "window.focus":
      return focusWindow(state, action.windowId);
    case "window.move": {
      const positionX = validateWindowCoordinate(action.x, "x");
      const positionY = validateWindowCoordinate(action.y, "y");
      return updateActiveArea(state, (area) => {
        const index = area.windows.findIndex((item) => item.id === action.windowId);
        if (index < 0 || area.windows[index].maximized) return area;
        const current = area.windows[index];
        if (current.positionX === positionX && current.positionY === positionY) return area;
        const windows = area.windows.map((item, itemIndex) =>
          itemIndex === index ? { ...item, positionX, positionY } : item
        );
        return { ...area, windows };
      });
    }
    case "window.minimize":
      return updateActiveArea(state, (area) => {
        const index = area.windows.findIndex((item) => item.id === action.windowId);
        if (index < 0) return area;
        const windows = area.windows.map((item, itemIndex) =>
          itemIndex === index ? { ...item, minimized: true } : item
        );
        return {
          ...area,
          windows,
          activeWindowId:
            area.activeWindowId === action.windowId ? activeFallback(windows) : area.activeWindowId,
        };
      });
    case "window.maximize":
      return updateActiveArea(state, (area) => {
        const index = area.windows.findIndex((item) => item.id === action.windowId);
        if (index < 0) return area;
        const updated = {
          ...area.windows[index],
          minimized: false,
          maximized: !area.windows[index].maximized,
        };
        const windows = [
          ...area.windows.slice(0, index),
          ...area.windows.slice(index + 1),
          updated,
        ];
        return { ...area, windows, activeWindowId: action.windowId };
      });
    case "window.close":
      return updateActiveArea(state, (area) => {
        const windows = area.windows.filter((item) => item.id !== action.windowId);
        if (windows.length === area.windows.length) return area;
        return {
          ...area,
          windows,
          activeWindowId:
            area.activeWindowId === action.windowId ? activeFallback(windows) : area.activeWindowId,
        };
      });
    case "workspace.show-desktop": {
      const area = getActiveArea(state);
      if (!area.windows.some((item) => !item.minimized) && !state.launcherOpen) return state;
      return updateActiveArea(state, (current) => ({
        ...current,
        windows: current.windows.map((item) => ({ ...item, minimized: true })),
        activeWindowId: null,
      }), { launcherOpen: false });
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
