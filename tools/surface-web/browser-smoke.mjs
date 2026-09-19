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
  'system/surface/ui/internet.css',
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
    const notesRich = await import(
      namespaceUrls['composition-first']['system/surface/ui/notes-rich-editor.mjs']
    );
    const placeCaret = (element, atEnd = true) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(!atEnd);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    const emptyEditorProbe = notesRich.createNotesRichEditor(document);
    notesRich.renderNotesRichBody(emptyEditorProbe, {
      blocks: [{ type: 'paragraph', text: '', marks: [] }],
    });
    document.body.append(emptyEditorProbe);
    result.notesEmptyEditorState = emptyEditorProbe.dataset.notesEmptyState === 'true';

    const blockEditorProbe = notesRich.createNotesRichEditor(document);
    notesRich.renderNotesRichBody(blockEditorProbe, {
      blocks: [{ type: 'heading', text: 'Título', marks: [] }],
    });
    document.body.append(blockEditorProbe);
    let probeBlock = blockEditorProbe.querySelector('[data-notes-rich-block]');
    placeCaret(probeBlock, true);
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    result.notesHeadingEnterHandled = notesRich.handleNotesRichBlockKeyDown(
      blockEditorProbe,
      enterEvent,
    ) === true && enterEvent.defaultPrevented === true
      && blockEditorProbe.children.length === 2
      && blockEditorProbe.children[0].dataset.notesBlockType === 'heading'
      && blockEditorProbe.children[1].dataset.notesBlockType === 'paragraph';

    probeBlock = blockEditorProbe.children[1];
    probeBlock.dataset.notesBlockType = 'quote';
    placeCaret(probeBlock, false);
    const backspaceEvent = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    result.notesBackspaceExitsBlock = notesRich.handleNotesRichBlockKeyDown(
      blockEditorProbe,
      backspaceEvent,
    ) === true && backspaceEvent.defaultPrevented === true
      && probeBlock.dataset.notesBlockType === 'paragraph';

    const bulletEditorProbe = notesRich.createNotesRichEditor(document);
    notesRich.renderNotesRichBody(bulletEditorProbe, {
      blocks: [{ type: 'bullet', text: 'Item', marks: [] }],
    });
    document.body.append(bulletEditorProbe);
    placeCaret(bulletEditorProbe.children[0], true);
    const bulletEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    notesRich.handleNotesRichBlockKeyDown(bulletEditorProbe, bulletEnterEvent);
    result.notesBulletEnterContinuesList = bulletEditorProbe.children.length === 2
      && bulletEditorProbe.children[1].dataset.notesBlockType === 'bullet';

    const softBreakProbe = notesRich.createNotesRichEditor(document);
    notesRich.renderNotesRichBody(softBreakProbe, {
      blocks: [{ type: 'paragraph', text: 'Linha', marks: [] }],
    });
    document.body.append(softBreakProbe);
    placeCaret(softBreakProbe.children[0], true);
    const softBreakEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    notesRich.handleNotesRichBlockKeyDown(softBreakProbe, softBreakEvent);
    result.notesShiftEnterKeepsBlock = softBreakEvent.defaultPrevented === true
      && softBreakProbe.children.length === 1
      && softBreakProbe.textContent === 'Linha\\n';

    emptyEditorProbe.remove();
    blockEditorProbe.remove();
    bulletEditorProbe.remove();
    softBreakProbe.remove();

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

    await launch('notes');
    let notesSlot = root.querySelector(
      '[data-window-id="notes"] [data-app-extension="notes-workspace"]',
    );
    result.notesOwnerMounted = Boolean(notesSlot?.dataset.ordaxNotesMounted === 'true');
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    window.prompt = () => 'Projeto smoke';
    const newProjectButton = notesSlot?.querySelector('[data-notes-action="new-project"]');
    result.notesNewProjectActionPresent = Boolean(newProjectButton);
    newProjectButton?.click();
    await Promise.resolve();
    window.prompt = originalPrompt;
    let notesBeforeEdit = parsedStorage('ordax.notes.v1');
    const smokeProject = notesBeforeEdit?.projects?.find((project) => project.name === 'Projeto smoke');
    result.notesProjectCreated = Boolean(smokeProject);

    const newNoteButton = notesSlot?.querySelector('[data-notes-action="new-note"]');
    result.notesNewActionPresent = Boolean(newNoteButton);
    newNoteButton?.click();
    await Promise.resolve();
    const notesTitle = notesSlot?.querySelector('[data-notes-title]');
    const notesBody = notesSlot?.querySelector('[data-notes-body]');
    if (notesTitle && notesBody) {
      notesTitle.value = 'Nota persistida no smoke';
      notesTitle.dispatchEvent(new Event('input', { bubbles: true }));
      notesTitle.focus();
      const titleEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      result.notesTitleEnterFocusesEditor = notesTitle.dispatchEvent(titleEnterEvent) === false
        && document.activeElement === notesBody
        && notesTitle.value === 'Nota persistida no smoke';

      const richBlock = notesBody.querySelector('[data-notes-rich-block]');
      if (richBlock) richBlock.textContent = 'Conteúdo salvo localmente e disponível offline.';
      notesBody.dispatchEvent(new Event('input', { bubbles: true }));

      notesBody.focus();
      const textNode = richBlock?.firstChild;
      if (textNode?.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 'Conteúdo'.length);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        notesSlot.querySelector('[data-notes-action="bold"]')?.click();

        const italicStart = 'Conteúdo salvo '.length;
        const italicEnd = italicStart + 'localmente'.length;
        const walk = document.createTreeWalker(richBlock, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let startNode = null;
        let startOffset = 0;
        let endNode = null;
        let endOffset = 0;
        while (walk.nextNode()) {
          const candidate = walk.currentNode;
          const nextOffset = offset + candidate.nodeValue.length;
          if (!startNode && italicStart >= offset && italicStart <= nextOffset) {
            startNode = candidate;
            startOffset = italicStart - offset;
          }
          if (!endNode && italicEnd >= offset && italicEnd <= nextOffset) {
            endNode = candidate;
            endOffset = italicEnd - offset;
          }
          offset = nextOffset;
        }
        if (startNode && endNode) {
          const italicRange = document.createRange();
          italicRange.setStart(startNode, startOffset);
          italicRange.setEnd(endNode, endOffset);
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(italicRange);
          document.dispatchEvent(new Event('selectionchange'));
          notesBody.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'i',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }));
        }

        const saveEvent = new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        result.notesSaveShortcutPreventedBrowserDialog = notesBody.dispatchEvent(saveEvent) === false;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 380));
    }
    const notesStorage = parsedStorage('ordax.notes.v1');
    const persistedNote = notesStorage?.notes?.find((item) => item.id === notesStorage.selectedNoteId);
    result.notesAutosavePersisted = persistedNote?.title === 'Nota persistida no smoke'
      && persistedNote?.body === 'Conteúdo salvo localmente e disponível offline.';
    result.notesRichTextPersisted = persistedNote?.richBody?.blocks?.[0]?.marks
      ?.some((mark) => mark.type === 'bold' && mark.start === 0 && mark.end === 'Conteúdo'.length) === true;
    result.notesItalicShortcutPersisted = persistedNote?.richBody?.blocks?.[0]?.marks
      ?.some((mark) => mark.type === 'italic'
        && mark.start === 'Conteúdo salvo '.length
        && mark.end === 'Conteúdo salvo localmente'.length) === true;
    result.notesPlainBodyHasNoMarkup = persistedNote?.body?.includes('**') === false;
    result.notesCreatedInsideProject = persistedNote?.projectId === smokeProject?.id;

    const moreButton = notesSlot?.querySelector('[data-notes-action="toggle-menu"]');
    moreButton?.click();
    await Promise.resolve();
    const transientMenu = notesSlot?.querySelector('.ordax-notes-menu');
    const menuOpenedForEscape = transientMenu?.hidden === false;
    notesBody?.focus();
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    result.notesEscapeClosesTransientMenu = menuOpenedForEscape
      && notesBody?.dispatchEvent(escapeEvent) === false
      && transientMenu?.hidden === true;

    const addTaskButton = notesSlot?.querySelector('[data-notes-action="add-task"]');
    addTaskButton?.click();
    await Promise.resolve();
    let notesAfterTask = parsedStorage('ordax.notes.v1');
    let taskNote = notesAfterTask?.notes?.find((item) => item.id === notesAfterTask.selectedNoteId);
    result.notesTaskCreated = taskNote?.tasks?.length === 1;
    notesSlot?.querySelector('[data-notes-action="remove-task"]')?.click();
    await Promise.resolve();
    notesAfterTask = parsedStorage('ordax.notes.v1');
    taskNote = notesAfterTask?.notes?.find((item) => item.id === notesAfterTask.selectedNoteId);
    result.notesTaskRemoved = taskNote?.tasks?.length === 0;

    notesSlot?.querySelector('[data-notes-action="toggle-menu"]')?.click();
    await Promise.resolve();
    const moveHome = notesSlot?.querySelector(
      '[data-notes-action="move-note-project"][data-project-id="meu-espaco"]',
    );
    result.notesMoveActionPresent = Boolean(moveHome);
    moveHome?.click();
    await Promise.resolve();
    const notesAfterMove = parsedStorage('ordax.notes.v1');
    const movedNote = notesAfterMove?.notes?.find((item) => item.id === notesAfterMove.selectedNoteId);
    result.notesMovedToHome = movedNote?.projectId === 'meu-espaco'
      && notesAfterMove?.selectedProjectId === 'meu-espaco';

    const projectRow = [...notesSlot?.querySelectorAll('.ordax-notes-project-row') ?? []]
      .find((row) => row.querySelector('.ordax-notes-project-name')?.textContent === 'Projeto smoke');
    const projectActions = projectRow?.querySelector('[data-notes-action="project-actions"]');
    result.notesProjectActionsPresent = Boolean(projectActions);
    projectActions?.click();
    await Promise.resolve();
    window.prompt = () => 'Projeto smoke renomeado';
    notesSlot?.querySelector('[data-notes-action="rename-project"]')?.click();
    await Promise.resolve();
    window.prompt = originalPrompt;
    let notesAfterProjectEdit = parsedStorage('ordax.notes.v1');
    result.notesProjectRenamed = notesAfterProjectEdit?.projects
      ?.some((project) => project.name === 'Projeto smoke renomeado') === true;

    const renamedProjectRow = [...notesSlot?.querySelectorAll('.ordax-notes-project-row') ?? []]
      .find((row) => row.querySelector('.ordax-notes-project-name')?.textContent === 'Projeto smoke renomeado');
    renamedProjectRow?.querySelector('[data-notes-action="project-actions"]')?.click();
    await Promise.resolve();
    window.confirm = () => true;
    notesSlot?.querySelector('[data-notes-action="remove-project"]')?.click();
    await Promise.resolve();
    window.confirm = originalConfirm;
    notesAfterProjectEdit = parsedStorage('ordax.notes.v1');
    result.notesProjectRemovedSafely = notesAfterProjectEdit?.projects
      ?.every((project) => project.name !== 'Projeto smoke renomeado') === true
      && notesAfterProjectEdit?.notes?.some(
        (item) => item.id === notesAfterProjectEdit.selectedNoteId && item.projectId === 'meu-espaco',
      ) === true;

    notesSlot?.querySelector('[data-notes-action="toggle-menu"]')?.click();
    await Promise.resolve();
    notesSlot?.querySelector('[data-notes-action="trash-note"]')?.click();
    await Promise.resolve();
    notesSlot?.querySelector('[data-notes-action="view-trash"]')?.click();
    await Promise.resolve();

    const trashTitle = notesSlot?.querySelector('[data-notes-title]');
    const trashBody = notesSlot?.querySelector('[data-notes-body]');
    const trashDocument = notesSlot?.querySelector('[data-notes-document]');
    const trashAddTask = notesSlot?.querySelector('[data-notes-action="add-task"]');
    const trashAddReference = notesSlot?.querySelector('[data-notes-action="add-reference"]');
    result.notesTrashIsReadOnly = trashTitle?.readOnly === true
      && trashBody?.contentEditable === 'false'
      && trashBody?.getAttribute('aria-readonly') === 'true'
      && trashDocument?.dataset.deleted === 'true'
      && trashAddTask?.disabled === true
      && trashAddReference?.disabled === true
      && notesSlot?.querySelector('.ordax-notes-save-status')?.textContent
        ?.includes('Na lixeira') === true;

    notesSlot?.querySelector('[data-notes-action="toggle-menu"]')?.click();
    await Promise.resolve();
    notesSlot?.querySelector('[data-notes-action="restore-note"]')?.click();
    await Promise.resolve();

    const restoredTitle = notesSlot?.querySelector('[data-notes-title]');
    const restoredBody = notesSlot?.querySelector('[data-notes-body]');
    result.notesRestoreReenablesEditing = restoredTitle?.readOnly === false
      && restoredBody?.contentEditable === 'true'
      && restoredBody?.getAttribute('aria-readonly') === 'false'
      && notesSlot?.querySelector('[data-notes-document]')?.dataset.deleted === 'false'
      && restoredTitle?.value === 'Nota persistida no smoke';

    const imageToolButton = notesSlot?.querySelector('[data-notes-action="insert-image"]');
    result.notesImageToolPresent = Boolean(imageToolButton);
    result.notesImageToolFailsClosedOnWeb = imageToolButton?.disabled === true;

    const addReferenceButton = notesSlot?.querySelector('[data-notes-action="add-reference"]');
    result.notesReferenceActionPresent = Boolean(addReferenceButton);
    addReferenceButton?.click();
    await Promise.resolve();
    const fileReferenceChoice = notesSlot?.querySelector('[data-notes-action="add-file-reference"]');
    const linkReferenceChoice = notesSlot?.querySelector('[data-notes-action="add-link-reference"]');
    result.notesFileReferenceChoicePresent = Boolean(fileReferenceChoice);
    result.notesFileReferenceFailsClosedOnWeb = fileReferenceChoice?.disabled === true;

    const referencePromptValues = ['  https://Example.COM/docs?q=1  ', 'Documentação'];
    window.prompt = () => referencePromptValues.shift() ?? null;
    try {
      linkReferenceChoice?.click();
      await Promise.resolve();
    } finally {
      window.prompt = originalPrompt;
    }
    const storedReference = parsedStorage('ordax.notes.v1')?.notes
      ?.flatMap((item) => item.references ?? [])
      ?.find((reference) => reference.title === 'Documentação');
    const renderedReference = [...(notesSlot?.querySelectorAll('.ordax-notes-ref-card[data-href]') ?? [])]
      .find((card) => card.dataset.href === 'https://example.com/docs?q=1');
    result.notesWebReferenceAdded = storedReference?.href === 'https://example.com/docs?q=1'
      && storedReference?.kind === 'link';
    result.notesWebReferenceHostRendered = renderedReference
      ?.querySelector('small')?.textContent === 'example.com';

    renderedReference?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    const internetSlot = root.querySelector(
      '[data-window-id="internet"] [data-app-extension="internet-browser"]',
    );
    const internetWorkspace = parsedStorage('ordax.workspace.v2');
    const internetArea = internetWorkspace?.areas
      ?.find((area) => area.id === internetWorkspace.activeAreaId) ?? internetWorkspace?.areas?.[0];
    const storedInternet = internetArea?.windows?.find((item) => item.appId === 'internet');
    result.notesReferenceOpenedInInternet = Boolean(
      internetSlot?.dataset.ordaxInternetMounted === 'true',
    );
    result.internetTargetPersisted = storedInternet?.target === 'https://example.com/docs?q=1';
    result.internetFailsClosedOnWeb = internetSlot
      ?.querySelector('.ordax-internet-unavailable')?.textContent
      ?.includes('Navegação integrada não disponível neste host') === true;
    result.internetDoesNotEmbedWebContent = internetSlot?.querySelector('iframe') === null
      && internetSlot?.querySelector('[data-browser-viewport] iframe') === null;

    const closePendingTitle = notesSlot?.querySelector('[data-notes-title]');
    closePendingTitle.value = 'Nota salva ao fechar';
    closePendingTitle.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-window-id="notes"] [data-window-action="close"]')?.click();
    result.notesWindowClosedWithPendingEdit = root.querySelector('[data-window-id="notes"]') === null
      && parsedStorage('ordax.notes.v1')?.notes?.some(
        (item) => item.title === 'Nota salva ao fechar',
      ) === true;

    await launch('notes');
    notesSlot = root.querySelector(
      '[data-window-id="notes"] [data-app-extension="notes-workspace"]',
    );
    result.notesPendingEditRestoredAfterClose = notesSlot
      ?.querySelector('[data-notes-title]')?.value === 'Nota salva ao fechar';

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

    const restoredNotesSlot = root?.querySelector(
      '[data-window-id="notes"] [data-app-extension="notes-workspace"]',
    );
    result.notesWindowRestored = Boolean(restoredNotesSlot);
    result.notesOwnerRestored = Boolean(restoredNotesSlot?.dataset.ordaxNotesMounted === 'true');
    result.notesContentRestored = restoredNotesSlot?.querySelector('[data-notes-title]')?.value === 'Nota salva ao fechar';
    const restoredNotesBody = restoredNotesSlot?.querySelector('[data-notes-body]');
    result.notesRichTextRestored = restoredNotesBody?.textContent === 'Conteúdo salvo localmente e disponível offline.'
      && restoredNotesBody?.querySelector('strong')?.textContent === 'Conteúdo';

    const restoredInternetSlot = root?.querySelector(
      '[data-window-id="internet"] [data-app-extension="internet-browser"]',
    );
    const restoredWorkspace = parsedStorage('ordax.workspace.v2');
    const restoredActiveArea = restoredWorkspace?.areas
      ?.find((area) => area.id === restoredWorkspace.activeAreaId) ?? restoredWorkspace?.areas?.[0];
    const restoredInternetWindow = restoredActiveArea?.windows
      ?.find((item) => item.appId === 'internet');
    result.internetWindowRestored = Boolean(
      restoredInternetSlot?.dataset.ordaxInternetMounted === 'true',
    );
    result.internetTargetRestored = restoredInternetWindow?.target
      === 'https://example.com/docs?q=1';
    result.internetStillFailsClosedOnWeb = restoredInternetSlot
      ?.querySelector('.ordax-internet-unavailable')?.textContent
      ?.includes('Navegação integrada não disponível neste host') === true;

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
      'workspaceTargetPersisted', 'notesEmptyEditorState', 'notesHeadingEnterHandled',
      'notesBackspaceExitsBlock', 'notesBulletEnterContinuesList', 'notesShiftEnterKeepsBlock',
      'notesOwnerMounted', 'notesNewProjectActionPresent', 'notesProjectCreated',
      'notesNewActionPresent', 'notesTitleEnterFocusesEditor', 'notesAutosavePersisted',
      'notesRichTextPersisted', 'notesItalicShortcutPersisted', 'notesSaveShortcutPreventedBrowserDialog',
      'notesEscapeClosesTransientMenu', 'notesPlainBodyHasNoMarkup',
      'notesCreatedInsideProject', 'notesTaskCreated', 'notesTaskRemoved', 'notesMoveActionPresent',
      'notesMovedToHome', 'notesProjectActionsPresent', 'notesProjectRenamed', 'notesProjectRemovedSafely',
      'notesTrashIsReadOnly', 'notesRestoreReenablesEditing',
      'notesImageToolPresent', 'notesImageToolFailsClosedOnWeb',
      'notesReferenceActionPresent', 'notesFileReferenceChoicePresent', 'notesFileReferenceFailsClosedOnWeb',
      'notesWebReferenceAdded', 'notesWebReferenceHostRendered',
      'notesReferenceOpenedInInternet', 'internetTargetPersisted',
      'internetFailsClosedOnWeb', 'internetDoesNotEmbedWebContent',
      'notesWindowClosedWithPendingEdit', 'notesPendingEditRestoredAfterClose',
      'accountOwnerMounted', 'accountUnavailable', 'accountNoFakeIdentityAction',
      'systemOwnerMounted', 'systemOverviewDefault',
      'systemNavigationComplete', 'firstMountDestroyed', 'textScaleClearedOnDestroy',
      'remountCompositionMounted', 'themeRestored', 'textScaleRestored', 'settingsWindowRestored',
      'settingsTargetRestored', 'notesWindowRestored', 'notesOwnerRestored', 'notesContentRestored',
      'notesRichTextRestored', 'internetWindowRestored', 'internetTargetRestored',
      'internetStillFailsClosedOnWeb',
      'accountWindowRestored', 'accountOwnerRestored', 'accountStillUnavailable', 'accountStillHasNoFakeIdentityAction', 'systemWindowRestored',
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
    const detail = evaluation.exceptionDetails.exception?.description
      ?? evaluation.exceptionDetails.exception?.value
      ?? evaluation.exceptionDetails.text
      ?? 'unknown exception';
    throw new Error(`${label} browser proof threw: ${detail}`);
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
