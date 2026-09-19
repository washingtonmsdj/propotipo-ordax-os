#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const STATIC_IMPORT_RE = /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const SURFACE_ROOT_MODULE = 'system/surface/ui/surface.mjs';
const WEB_COMPOSITION_ROOT_MODULE = 'system/composition/web/main.mjs';
const ROOT_MODULES = [SURFACE_ROOT_MODULE, WEB_COMPOSITION_ROOT_MODULE];
const CSS_FILES = [
  'system/surface/ui/tokens.css',
  'system/surface/ui/surface.css',
  'system/surface/ui/workspace-areas.css',
  'system/surface/ui/files.css',
  'system/surface/ui/notes.css',
  'system/surface/ui/system.css',
  'system/surface/ui/account.css',
  'system/surface/ui/settings.css',
];

function parseArgs(argv) {
  let bundleDir = 'out/web-client';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--bundle-dir') {
      bundleDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${value}`);
  }
  return { bundleDir: resolve(bundleDir) };
}

function assertInside(root, candidate) {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`bundle dependency escapes bundle root: ${candidate}`);
  }
}

function resolveModule(bundleDir, sourcePath, specifier) {
  if (!specifier.startsWith('.')) {
    throw new Error(`browser smoke only accepts relative local ESM dependencies: ${sourcePath} -> ${specifier}`);
  }
  const candidate = normalize(join(dirname(sourcePath), specifier)).replaceAll('\\', '/');
  const absolute = resolve(bundleDir, candidate);
  assertInside(bundleDir, absolute);
  if (!existsSync(absolute)) {
    throw new Error(`missing browser smoke dependency: ${candidate}`);
  }
  return candidate;
}

function moduleSpecifiers(source) {
  const values = new Set();
  for (const match of source.matchAll(STATIC_IMPORT_RE)) values.add(match[1]);
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) values.add(match[1]);
  return [...values];
}

function moduleKey(path, namespace = 'shell') {
  return `ordax-module/${namespace}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function rewriteModule(source, sourcePath, bundleDir, namespace = 'shell') {
  const rewrite = (full, specifier) => {
    const dependency = resolveModule(bundleDir, sourcePath, specifier);
    return full.replace(specifier, moduleKey(dependency, namespace));
  };
  return source
    .replace(STATIC_IMPORT_RE, rewrite)
    .replace(DYNAMIC_IMPORT_RE, rewrite);
}

async function collectModules(bundleDir) {
  const pending = [...ROOT_MODULES];
  const sources = new Map();
  while (pending.length > 0) {
    const path = pending.pop();
    if (sources.has(path)) continue;
    const source = await readFile(join(bundleDir, path), 'utf8');
    sources.set(path, source);
    for (const specifier of moduleSpecifiers(source)) {
      pending.push(resolveModule(bundleDir, path, specifier));
    }
  }
  return sources;
}

function which(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(command)}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findBrowser() {
  const candidates = [
    process.env.ORDAX_CHROME_BIN,
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Chromium not found; set ORDAX_CHROME_BIN to an executable browser');
}

const STARTUP_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 8_000;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function appendDiagnostic(current, chunk) {
  const combined = current + chunk;
  return combined.length <= STDERR_LIMIT ? combined : combined.slice(-STDERR_LIMIT);
}

function exitSummary(exitState) {
  if (!exitState) return 'still running';
  const fields = [];
  if (exitState.code !== null) fields.push(`code=${exitState.code}`);
  if (exitState.signal !== null) fields.push(`signal=${exitState.signal}`);
  return fields.length > 0 ? fields.join(', ') : 'exited';
}

async function reserveLoopbackPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a loopback CDP port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(port);
      });
    });
  });
}

async function waitForDevTools(
  port,
  getExitState,
  getSpawnError,
  getStderr,
  timeoutMs = STARTUP_TIMEOUT_MS,
) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const spawnError = getSpawnError();
    if (spawnError) {
      throw new Error(`failed to spawn Chromium: ${spawnError.message}`);
    }
    const exitState = getExitState();
    if (exitState) {
      throw new Error(
        `Chromium exited before CDP became ready (${exitSummary(exitState)}); stderr=${JSON.stringify(getStderr())}`,
      );
    }

    const controller = new AbortController();
    const requestTimeoutMs = Math.min(1_000, remainingMs);
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    const pauseMs = Math.min(50, deadline - Date.now());
    if (pauseMs > 0) await sleep(pauseMs);
  }

  throw new Error(
    `timed out waiting for Chromium CDP at ${endpoint}; process=${exitSummary(getExitState())}; last=${lastError?.message ?? 'none'}; stderr=${JSON.stringify(getStderr())}`,
  );
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out opening DevTools WebSocket')), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`DevTools WebSocket error: ${event?.message ?? 'unknown error'}`));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function buildProofExpression(moduleSources, styles) {
  const namespace = 'shell';
  const rewritten = Object.fromEntries(
    [...moduleSources.entries()].map(([path, source]) => [path, rewriteModule(source, path, bundleDirGlobal, namespace)]),
  );
  const moduleKeys = Object.fromEntries(
    [...moduleSources.keys()].map((path) => [path, moduleKey(path, namespace)]),
  );
  return `(async () => {
    const sources = ${JSON.stringify(rewritten)};
    const keys = ${JSON.stringify(moduleKeys)};
    document.open();
    document.write('<!doctype html><html><head></head><body><div id="ordax-proof-root"></div></body></html>');
    document.close();
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(styles)};
    document.head.append(style);

    const urls = Object.create(null);
    for (const [path, source] of Object.entries(sources)) {
      urls[path] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    }
    const imports = Object.create(null);
    for (const [path, key] of Object.entries(keys)) imports[key] = urls[path];
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports });
    document.head.append(importMap);

    const { mountSurface } = await import(urls[${JSON.stringify('system/surface/ui/surface.mjs')}]);
    let snapshot = { capabilityIds: [], connectivity: 'offline' };
    const listeners = new Set();
    const host = {
      schema: 'ordax.surface-host/1',
      getSnapshot() { return snapshot; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      emit(next) { snapshot = next; for (const listener of [...listeners]) listener(snapshot); },
    };
    const savedWorkspaces = [];
    const workspaceStore = {
      schema: 'ordax.workspace-store/2',
      load() { return null; },
      save(value) { savedWorkspaces.push(value); },
    };
    const root = document.querySelector('#ordax-proof-root');
    const surface = mountSurface(root, host, null, workspaceStore);
    const result = {};
    result.shellMounted = Boolean(root.querySelector('[data-workspace]'));
    result.launcherApps = root.querySelectorAll('[data-launch-app]').length;

    root.querySelector('[data-launcher-toggle]').click();
    const settingsLaunch = root.querySelector('[data-launch-app="settings"]');
    result.settingsLaunchPresent = Boolean(settingsLaunch);
    settingsLaunch.click();

    const windowBefore = root.querySelector('[data-window-id="settings"]');
    const slotBefore = windowBefore?.querySelector('[data-app-extension="settings-overview"]');
    const bodyBefore = windowBefore?.querySelector('.ordax-window-body');
    result.settingsWindowCreated = Boolean(windowBefore && slotBefore && bodyBefore);

    bodyBefore.style.height = '120px';
    bodyBefore.style.maxHeight = '120px';
    const input = document.createElement('input');
    input.dataset.proofDraft = '';
    input.value = 'rascunho-nao-persistido';
    const spacer = document.createElement('div');
    spacer.style.height = '1200px';
    spacer.textContent = 'proof spacer';
    slotBefore.append(input, spacer);
    bodyBefore.scrollTop = 90;
    input.focus({ preventScroll: true });
    const scrollBefore = bodyBefore.scrollTop;
    result.focusBeforeSnapshot = document.activeElement === input;
    result.scrollBeforeSnapshot = scrollBefore;

    host.emit({ capabilityIds: [], connectivity: 'online' });
    const windowAfterSnapshot = root.querySelector('[data-window-id="settings"]');
    const slotAfterSnapshot = windowAfterSnapshot?.querySelector('[data-app-extension="settings-overview"]');
    const bodyAfterSnapshot = windowAfterSnapshot?.querySelector('.ordax-window-body');
    result.sameWindowAfterSnapshot = windowAfterSnapshot === windowBefore;
    result.sameSlotAfterSnapshot = slotAfterSnapshot === slotBefore;
    result.sameInputAfterSnapshot = slotAfterSnapshot?.querySelector('[data-proof-draft]') === input;
    result.focusAfterSnapshot = document.activeElement === input;
    result.scrollPreservedAfterSnapshot = bodyAfterSnapshot?.scrollTop === scrollBefore;
    result.draftPreservedAfterSnapshot = input.value === 'rascunho-nao-persistido';

    surface.preferences.set('appearance.theme', 'dark');
    const windowAfterPreference = root.querySelector('[data-window-id="settings"]');
    result.sameWindowAfterPreference = windowAfterPreference === windowBefore;
    result.sameInputAfterPreference = windowAfterPreference?.querySelector('[data-proof-draft]') === input;
    result.focusAfterPreference = document.activeElement === input;
    result.scrollPreservedAfterPreference = windowAfterPreference?.querySelector('.ordax-window-body')?.scrollTop === scrollBefore;

    const minimize = windowBefore.querySelector('[data-window-action="minimize"]');
    minimize.click();
    result.savedAfterMinimize = savedWorkspaces.at(-1)?.areas?.[0]?.windows?.find((item) => item.id === 'settings')?.minimized === true;
    result.sameWindowWhileMinimized = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.windowHiddenWhenMinimized = windowBefore.hidden === true;
    result.minimizedDatasetAfterClick = windowBefore.dataset.minimized === 'true';
    result.dockOffersRestore = root.querySelector('[data-open-window="settings"]')?.getAttribute('aria-label') === 'Restaurar Ajustes';
    result.draftPreservedWhileMinimized = input.value === 'rascunho-nao-persistido';
    result.focusMovedToWorkspaceOnMinimize = document.activeElement === root.querySelector('[data-workspace]');

    root.querySelector('[data-open-window="settings"]').click();
    result.sameWindowAfterRestore = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.windowVisibleAfterRestore = windowBefore.hidden === false;
    result.sameInputAfterRestore = windowBefore.querySelector('[data-proof-draft]') === input;
    result.draftPreservedAfterRestore = input.value === 'rascunho-nao-persistido';
    result.scrollPreservedAfterRestore = bodyBefore.scrollTop === scrollBefore;

    const maximize = windowBefore.querySelector('[data-window-action="maximize"]');
    maximize.click();
    result.sameWindowAfterMaximize = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.maximizedDatasetAfterClick = windowBefore.dataset.maximized === 'true';
    maximize.click();
    result.sameWindowAfterUnmaximize = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.maximizedDatasetAfterUnmaximize = windowBefore.dataset.maximized === 'false';

    root.querySelector('[data-launcher-toggle]').click();
    const systemLaunchBefore = root.querySelector('[data-launch-app="system"]');
    systemLaunchBefore.focus({ preventScroll: true });
    host.emit({ capabilityIds: [], connectivity: 'offline' });
    const systemLaunchAfter = root.querySelector('[data-launch-app="system"]');
    result.sameLauncherNodeAfterSnapshot = systemLaunchAfter === systemLaunchBefore;
    result.launcherFocusPreserved = document.activeElement === systemLaunchBefore;

    windowBefore.querySelector('[data-window-action="close"]').click();
    result.windowRemovedAfterClose = root.querySelector('[data-window-id="settings"]') === null;
    result.dockRemovedAfterClose = root.querySelector('[data-open-window="settings"]') === null;
    result.focusMovedToWorkspaceOnClose = document.activeElement === root.querySelector('[data-workspace]');

    const required = [
      'shellMounted', 'settingsLaunchPresent', 'settingsWindowCreated', 'focusBeforeSnapshot',
      'sameWindowAfterSnapshot', 'sameSlotAfterSnapshot', 'sameInputAfterSnapshot',
      'focusAfterSnapshot', 'scrollPreservedAfterSnapshot', 'draftPreservedAfterSnapshot',
      'sameWindowAfterPreference', 'sameInputAfterPreference', 'focusAfterPreference',
      'scrollPreservedAfterPreference', 'savedAfterMinimize', 'sameWindowWhileMinimized',
      'windowHiddenWhenMinimized', 'minimizedDatasetAfterClick', 'dockOffersRestore',
      'draftPreservedWhileMinimized', 'focusMovedToWorkspaceOnMinimize', 'sameWindowAfterRestore',
      'windowVisibleAfterRestore', 'sameInputAfterRestore', 'draftPreservedAfterRestore',
      'scrollPreservedAfterRestore', 'sameWindowAfterMaximize', 'maximizedDatasetAfterClick',
      'sameWindowAfterUnmaximize', 'maximizedDatasetAfterUnmaximize', 'sameLauncherNodeAfterSnapshot',
      'launcherFocusPreserved', 'windowRemovedAfterClose', 'dockRemovedAfterClose',
      'focusMovedToWorkspaceOnClose',
    ];
    result.requiredAssertions = Object.fromEntries(required.map((name) => [name, Boolean(result[name])]));
    result.allCoreAssertions = result.launcherApps >= 4 && Object.values(result.requiredAssertions).every(Boolean);

    surface.destroy();
    for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    return result;
  })()`;
}

function buildCompositionProofExpression(moduleSources, styles) {
  const namespaces = ['composition-first', 'composition-remount'];
  const namespaceSources = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      Object.fromEntries(
        [...moduleSources.entries()].map(([path, source]) => [
          path,
          rewriteModule(source, path, bundleDirGlobal, namespace),
        ]),
      ),
    ]),
  );
  const namespaceKeys = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      Object.fromEntries(
        [...moduleSources.keys()].map((path) => [path, moduleKey(path, namespace)]),
      ),
    ]),
  );

  return `(async () => {
    const namespaceSources = ${JSON.stringify(namespaceSources)};
    const namespaceKeys = ${JSON.stringify(namespaceKeys)};
    const rootModule = ${JSON.stringify(WEB_COMPOSITION_ROOT_MODULE)};
    const storageRecords = new Map();
    const storage = {
      get length() { return storageRecords.size; },
      clear() { storageRecords.clear(); },
      getItem(key) { return storageRecords.has(String(key)) ? storageRecords.get(String(key)) : null; },
      key(index) { return [...storageRecords.keys()][index] ?? null; },
      removeItem(key) { storageRecords.delete(String(key)); },
      setItem(key, value) { storageRecords.set(String(key), String(value)); },
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: storage,
    });

    document.open();
    document.write('<!doctype html><html><head></head><body><div id="ordax-root"></div></body></html>');
    document.close();
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(styles)};
    document.head.append(style);

    const namespaceUrls = Object.create(null);
    const imports = Object.create(null);
    for (const [namespace, sources] of Object.entries(namespaceSources)) {
      const urls = Object.create(null);
      namespaceUrls[namespace] = urls;
      for (const [path, source] of Object.entries(sources)) {
        urls[path] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      }
      for (const [path, key] of Object.entries(namespaceKeys[namespace])) {
        imports[key] = urls[path];
      }
    }
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports });
    document.head.append(importMap);

    const result = {};
    const parsedStorage = (key) => {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    };
    const launch = async (appId) => {
      const root = document.querySelector('#ordax-root');
      const launcher = root.querySelector('[data-launcher]');
      if (launcher?.hidden !== false) root.querySelector('[data-launcher-toggle]').click();
      const button = root.querySelector('[data-launch-app="' + appId + '"]');
      if (!button) throw new Error('composition smoke could not find launcher app: ' + appId);
      button.click();
      await Promise.resolve();
    };

    await import(namespaceUrls['composition-first'][rootModule]);
    await Promise.resolve();
    let root = document.querySelector('#ordax-root');
    result.compositionMounted = Boolean(root?.querySelector('[data-workspace]'));

    await launch('settings');
    let settingsWindow = root.querySelector('[data-window-id="settings"]');
    let settingsSlot = settingsWindow?.querySelector('[data-app-extension="settings-overview"]');
    result.settingsWindowMounted = Boolean(settingsWindow);
    result.settingsOwnerMounted = Boolean(settingsSlot?.dataset.ordaxSettingsOverviewView !== undefined);
    result.settingsStartsAppearance = settingsSlot?.dataset.settingsActiveSection === 'appearance';

    const darkButton = settingsSlot?.querySelector(
      '[data-settings-preference-id="appearance.theme"][data-settings-preference-value="dark"]',
    );
    result.darkActionPresent = Boolean(darkButton);
    darkButton?.click();
    await Promise.resolve();
    result.darkThemeApplied = root.dataset.ordaxTheme === 'dark';
    result.darkThemePersisted = parsedStorage('ordax.preferences.v1')?.['appearance.theme'] === 'dark';

    const accessibilityButton = settingsSlot?.querySelector('[data-settings-section="accessibility"]');
    result.accessibilityNavigationPresent = Boolean(accessibilityButton);
    accessibilityButton?.click();
    await Promise.resolve();
    settingsWindow = root.querySelector('[data-window-id="settings"]');
    settingsSlot = settingsWindow?.querySelector('[data-app-extension="settings-overview"]');
    result.accessibilityTargetApplied = settingsSlot?.dataset.settingsActiveSection === 'accessibility';

    const extraLargeButton = settingsSlot?.querySelector(
      '[data-settings-preference-id="accessibility.text-scale"][data-settings-preference-value="extra-large"]',
    );
    result.extraLargeActionPresent = Boolean(extraLargeButton);
    extraLargeButton?.click();
    await Promise.resolve();
    result.textScaleApplied = document.documentElement.dataset.ordaxTextScale === 'extra-large';
    const preferences = parsedStorage('ordax.preferences.v1');
    result.textScalePersisted = preferences?.['accessibility.text-scale'] === 'extra-large';

    const workspace = parsedStorage('ordax.workspace.v2');
    const firstArea = workspace?.areas?.find((area) => area.id === workspace.activeAreaId) ?? workspace?.areas?.[0];
    const storedSettings = firstArea?.windows?.find((item) => item.appId === 'settings');
    result.workspaceTargetPersisted = storedSettings?.target === 'accessibility';

    await launch('account');
    const accountSlot = root.querySelector(
      '[data-window-id="account"] [data-app-extension="account-overview"]',
    );
    result.accountOwnerMounted = Boolean(accountSlot?.dataset.ordaxAccountOverviewView !== undefined);
    result.accountUnavailable = accountSlot?.querySelector('.ordax-account-status')?.dataset.state === 'unavailable';
    result.accountNoFakeIdentityAction = accountSlot?.querySelector('[data-account-identity-action]') === null;

    await launch('system');
    const systemSlot = root.querySelector(
      '[data-window-id="system"] [data-app-extension="system-overview"]',
    );
    result.systemOwnerMounted = Boolean(systemSlot?.dataset.ordaxSystemOverviewView !== undefined);
    result.systemOverviewDefault = systemSlot?.dataset.systemActiveSection === 'overview';
    result.systemNavigationComplete = systemSlot?.querySelectorAll('[data-system-section]').length === 5;

    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    result.firstMountDestroyed = root.childElementCount === 0;
    result.textScaleClearedOnDestroy = document.documentElement.dataset.ordaxTextScale === undefined;

    document.body.replaceChildren();
    const remountRoot = document.createElement('div');
    remountRoot.id = 'ordax-root';
    document.body.append(remountRoot);
    await import(namespaceUrls['composition-remount'][rootModule]);
    await Promise.resolve();
    root = document.querySelector('#ordax-root');
    result.remountCompositionMounted = Boolean(root?.querySelector('[data-workspace]'));
    result.themeRestored = root?.dataset.ordaxTheme === 'dark';
    result.textScaleRestored = document.documentElement.dataset.ordaxTextScale === 'extra-large';

    const restoredSettingsSlot = root?.querySelector(
      '[data-window-id="settings"] [data-app-extension="settings-overview"]',
    );
    result.settingsWindowRestored = Boolean(restoredSettingsSlot);
    result.settingsTargetRestored = restoredSettingsSlot?.dataset.settingsActiveSection === 'accessibility';

    const restoredAccountSlot = root?.querySelector(
      '[data-window-id="account"] [data-app-extension="account-overview"]',
    );
    result.accountWindowRestored = Boolean(restoredAccountSlot);
    result.accountOwnerRestored = Boolean(restoredAccountSlot?.dataset.ordaxAccountOverviewView !== undefined);
    result.accountStillUnavailable = restoredAccountSlot?.querySelector('.ordax-account-status')?.dataset.state === 'unavailable';
    result.accountStillHasNoFakeIdentityAction = restoredAccountSlot?.querySelector('[data-account-identity-action]') === null;

    const restoredSystemSlot = root?.querySelector(
      '[data-window-id="system"] [data-app-extension="system-overview"]',
    );
    result.systemWindowRestored = Boolean(restoredSystemSlot);
    result.systemOwnerRestored = Boolean(restoredSystemSlot?.dataset.ordaxSystemOverviewView !== undefined);
    result.systemOverviewRestored = restoredSystemSlot?.dataset.systemActiveSection === 'overview';

    const required = [
      'compositionMounted', 'settingsWindowMounted', 'settingsOwnerMounted', 'settingsStartsAppearance',
      'darkActionPresent', 'darkThemeApplied', 'darkThemePersisted', 'accessibilityNavigationPresent',
      'accessibilityTargetApplied', 'extraLargeActionPresent', 'textScaleApplied', 'textScalePersisted',
      'workspaceTargetPersisted', 'accountOwnerMounted', 'accountUnavailable',
      'accountNoFakeIdentityAction', 'systemOwnerMounted', 'systemOverviewDefault',
      'systemNavigationComplete', 'firstMountDestroyed', 'textScaleClearedOnDestroy',
      'remountCompositionMounted', 'themeRestored', 'textScaleRestored', 'settingsWindowRestored',
      'settingsTargetRestored', 'accountWindowRestored', 'accountOwnerRestored',
      'accountStillUnavailable', 'accountStillHasNoFakeIdentityAction', 'systemWindowRestored',
      'systemOwnerRestored', 'systemOverviewRestored',
    ];
    result.requiredAssertions = Object.fromEntries(required.map((name) => [name, Boolean(result[name])]));
    result.allCoreAssertions = Object.values(result.requiredAssertions).every(Boolean);

    window.dispatchEvent(new Event('pagehide'));
    for (const urls of Object.values(namespaceUrls)) {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    }
    return result;
  })()`;
}

async function waitForPageReady(client, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const evaluation = await client.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (evaluation.result?.value === 'complete') return;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(`timed out waiting for blank browser document: ${lastError?.message ?? 'not ready'}`);
}

async function evaluateProof(client, expression, label) {
  const evaluation = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(`${label} browser proof threw: ${evaluation.exceptionDetails.text ?? 'unknown exception'}`);
  }
  const result = evaluation.result?.value;
  if (!result || result.allCoreAssertions !== true) {
    throw new Error(`${label} browser assertions failed: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

let bundleDirGlobal = null;

async function main() {
  const { bundleDir } = parseArgs(process.argv.slice(2));
  bundleDirGlobal = bundleDir;
  if (typeof WebSocket !== 'function') {
    throw new Error(`Node ${process.version} does not provide the global WebSocket required by the CDP smoke gate`);
  }
  if (!existsSync(bundleDir)) throw new Error(`bundle directory does not exist: ${bundleDir}`);
  const modules = await collectModules(bundleDir);
  const styles = (await Promise.all(CSS_FILES.map((path) => readFile(join(bundleDir, path), 'utf8')))).join('\n');
  const browser = findBrowser();
  const cdpPort = await reserveLoopbackPort();
  const profile = await mkdtemp(join(tmpdir(), 'ordax-browser-smoke-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

  const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let exitState = null;
  let spawnError = null;
  let passed = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = appendDiagnostic(stderr, chunk); });
  child.once('exit', (code, signal) => { exitState = { code, signal }; });
  child.once('error', (error) => { spawnError = error; });
  let client = null;
  try {
    const startupStartedAt = Date.now();
    await waitForDevTools(
      cdpPort,
      () => exitState,
      () => spawnError,
      () => stderr,
    );
    const startupMs = Date.now() - startupStartedAt;
    console.log(`SURFACE_BROWSER_STARTUP_MS=${startupMs}`);
    const pagesResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    if (!pagesResponse.ok) {
      throw new Error(`Chromium CDP target list failed with HTTP ${pagesResponse.status}`);
    }
    const pages = await pagesResponse.json();
    const page = pages.find((item) => item.type === 'page');
    if (!page) throw new Error('Chromium did not expose a page target');
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Log.enable');
    const shellResult = await evaluateProof(
      client,
      buildProofExpression(modules, styles),
      'Surface shell',
    );
    await client.send('Page.navigate', { url: 'about:blank' });
    await waitForPageReady(client);
    const compositionResult = await evaluateProof(
      client,
      buildCompositionProofExpression(modules, styles),
      'Web composition',
    );
    const runtimeErrors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    const logErrors = client.events.filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error');
    if (runtimeErrors.length || logErrors.length) {
      throw new Error(`browser emitted runtime errors: ${JSON.stringify([...runtimeErrors, ...logErrors], null, 2)}`);
    }
    passed = true;
    console.log('SURFACE_BROWSER_SMOKE=PASS');
    console.log(`SURFACE_BROWSER_MODULE_COUNT=${modules.size}`);
    console.log(`SURFACE_BROWSER_EXECUTABLE=${browser}`);
    const shellAssertions = Object.keys(shellResult.requiredAssertions).length;
    const compositionAssertions = Object.keys(compositionResult.requiredAssertions).length;
    console.log(`SURFACE_BROWSER_SHELL_ASSERTIONS=${shellAssertions}`);
    console.log(`SURFACE_BROWSER_COMPOSITION_ASSERTIONS=${compositionAssertions}`);
    console.log(`SURFACE_BROWSER_ASSERTIONS=${shellAssertions + compositionAssertions}`);
  } finally {
    client?.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2_000);
        child.once('exit', () => { clearTimeout(timer); resolvePromise(); });
      });
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (!passed && stderr) {
      process.stderr.write(`CHROMIUM_STDERR_BEGIN\n${stderr}\nCHROMIUM_STDERR_END\n`);
    }
  }
}

main().catch((error) => {
  console.error('SURFACE_BROWSER_SMOKE=FAIL');
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
