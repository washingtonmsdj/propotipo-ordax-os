import {
  assertBrowserNavigation,
  createBrowserNavigation,
} from "../../services/browser/navigation.mjs";
import { assertSurfaceRenderLifecycle } from "./surface-lifecycle.mjs";

const BROWSER_WINDOW_SELECTOR = '[data-window-id="browser"]';
const BROWSER_EXTENSION_SELECTOR = '[data-app-extension="browser-workspace"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(documentObject, action, label, text) {
  const button = node(documentObject, "button", "ordax-browser-action", text);
  button.type = "button";
  button.dataset.browserAction = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function buildShell(documentObject) {
  const view = node(documentObject, "div", "ordax-browser-view");
  view.dataset.ordaxBrowserView = "";

  const toolbar = node(documentObject, "header", "ordax-browser-toolbar");
  const navigation = node(documentObject, "div", "ordax-browser-navigation");
  navigation.append(
    actionButton(documentObject, "back", "Voltar", "←"),
    actionButton(documentObject, "forward", "Avançar", "→"),
    actionButton(documentObject, "reload", "Recarregar", "↻"),
  );

  const form = node(documentObject, "form", "ordax-browser-address-form");
  form.dataset.browserAddressForm = "";
  const address = node(documentObject, "input", "ordax-browser-address");
  address.type = "text";
  address.inputMode = "url";
  address.autocomplete = "off";
  address.autocapitalize = "none";
  address.spellcheck = false;
  address.placeholder = "Digite um endereço";
  address.dataset.browserAddress = "";
  address.setAttribute("aria-label", "Endereço da web");
  const go = node(documentObject, "button", "ordax-browser-go", "Ir");
  go.type = "submit";
  go.setAttribute("aria-label", "Abrir endereço");
  form.append(address, go);
  toolbar.append(navigation, form);
  view.append(toolbar);

  const content = node(documentObject, "section", "ordax-browser-content");
  const start = node(documentObject, "div", "ordax-browser-start");
  start.dataset.browserStart = "";
  start.append(
    node(documentObject, "span", "ordax-browser-start-mark", "◎"),
    node(documentObject, "h2", "", "Navegador"),
    node(
      documentObject,
      "p",
      "",
      "Digite um endereço para abrir uma página em uma área isolada do sistema.",
    ),
  );

  const frame = node(documentObject, "iframe", "ordax-browser-frame");
  frame.dataset.browserFrame = "";
  frame.hidden = true;
  frame.setAttribute(
    "sandbox",
    "allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts",
  );
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'",
  );
  frame.setAttribute("title", "Conteúdo da página");
  content.append(start, frame);
  view.append(content);

  const footer = node(documentObject, "footer", "ordax-browser-statusbar");
  const status = node(documentObject, "span", "ordax-browser-status", "Pronto");
  status.dataset.browserStatus = "";
  const isolation = node(
    documentObject,
    "span",
    "ordax-browser-isolation",
    "Conteúdo web isolado da Surface",
  );
  footer.append(status, isolation);
  view.append(footer);
  return view;
}

export function mountBrowserWorkspaceControls(
  root,
  surfaceLifecycle = null,
  { windowRef = globalThis.window } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Browser workspace controls require a Surface root Element");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const documentObject = root.ownerDocument;
  const initialTarget = lifecycle.getAppTarget("browser");
  const navigation = assertBrowserNavigation(
    createBrowserNavigation({ initialUrl: initialTarget }),
  );

  let mountedSlot = null;
  let renderedRevision = -1;
  let errorMessage = "";
  let loading = false;
  let destroyed = false;

  const persistTarget = (state) => {
    lifecycle.setAppTarget("browser", state.currentUrl);
  };

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(BROWSER_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(BROWSER_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!slot.dataset.ordaxBrowserMounted) {
      slot.replaceChildren(buildShell(documentObject));
      slot.dataset.ordaxBrowserMounted = "true";
    }
    mountedSlot = slot;

    const target = lifecycle.getAppTarget("browser");
    let state = navigation.getSnapshot();
    if (target !== null && target !== state.currentUrl) {
      try {
        state = navigation.navigate(target);
        errorMessage = "";
      } catch {
        lifecycle.setAppTarget("browser", null);
        state = navigation.reset();
        errorMessage = "O endereço salvo não é válido.";
      }
    } else if (target === null && state.currentUrl !== null) {
      state = navigation.reset();
    }

    const view = slot.querySelector("[data-ordax-browser-view]");
    const address = view.querySelector("[data-browser-address]");
    if (documentObject.activeElement !== address) {
      address.value = state.currentUrl ?? "";
    }

    const back = view.querySelector('[data-browser-action="back"]');
    const forward = view.querySelector('[data-browser-action="forward"]');
    const reload = view.querySelector('[data-browser-action="reload"]');
    back.disabled = !state.canGoBack;
    forward.disabled = !state.canGoForward;
    reload.disabled = state.currentUrl === null;

    const start = view.querySelector("[data-browser-start]");
    const frame = view.querySelector("[data-browser-frame]");
    start.hidden = state.currentUrl !== null;
    frame.hidden = state.currentUrl === null;

    if (state.currentUrl !== null && renderedRevision !== state.revision) {
      renderedRevision = state.revision;
      loading = true;
      frame.dataset.browserUrl = state.currentUrl;
      frame.src = state.currentUrl;
    }

    const status = view.querySelector("[data-browser-status]");
    status.textContent = errorMessage || (loading ? "Carregando…" : state.currentUrl ? "Página carregada" : "Pronto");
    status.dataset.state = errorMessage ? "error" : loading ? "loading" : "ready";
  };

  const navigate = (value) => {
    try {
      const state = navigation.navigate(value);
      errorMessage = "";
      persistTarget(state);
      render();
      return true;
    } catch {
      errorMessage = "Digite um endereço HTTP ou HTTPS válido.";
      render();
      return false;
    }
  };

  const moveHistory = (direction) => {
    const before = navigation.getSnapshot();
    const state = direction === "back" ? navigation.back() : navigation.forward();
    if (state.revision === before.revision) return false;
    errorMessage = "";
    persistTarget(state);
    render();
    return true;
  };

  const reload = () => {
    const before = navigation.getSnapshot();
    const state = navigation.reload();
    if (state.revision === before.revision) return false;
    errorMessage = "";
    render();
    return true;
  };

  const onSubmit = (event) => {
    const form = event.target.closest?.("[data-browser-address-form]");
    if (!form || !mountedSlot?.contains(form)) return;
    event.preventDefault();
    navigate(form.querySelector("[data-browser-address]")?.value ?? "");
  };

  const onClick = (event) => {
    const action = event.target.closest?.("[data-browser-action]");
    if (!action || !mountedSlot?.contains(action)) return;
    if (action.dataset.browserAction === "back") moveHistory("back");
    if (action.dataset.browserAction === "forward") moveHistory("forward");
    if (action.dataset.browserAction === "reload") reload();
  };

  const onKeyDown = (event) => {
    if (!mountedSlot?.contains(event.target) || event.isComposing) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = String(event.key ?? "").toLocaleLowerCase("en-US");

    if (modifier && !event.altKey && key === "l") {
      event.preventDefault();
      const address = mountedSlot.querySelector("[data-browser-address]");
      address?.focus();
      address?.select();
      return;
    }
    if (modifier && !event.altKey && key === "r") {
      event.preventDefault();
      reload();
      return;
    }
    if (event.altKey && !modifier && event.key === "ArrowLeft") {
      event.preventDefault();
      moveHistory("back");
      return;
    }
    if (event.altKey && !modifier && event.key === "ArrowRight") {
      event.preventDefault();
      moveHistory("forward");
    }
  };

  const onFrameLoad = (event) => {
    if (!mountedSlot?.contains(event.target) || !event.target.matches?.("[data-browser-frame]")) return;
    loading = false;
    errorMessage = "";
    render();
  };

  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("load", onFrameLoad, true);
  const unsubscribeRender = lifecycle.subscribeRender(render);
  render();

  return Object.freeze({
    navigate,
    getSnapshot() {
      return navigation.getSnapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      navigation.destroy();
      unsubscribeRender?.();
      root.removeEventListener("submit", onSubmit);
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("load", onFrameLoad, true);
      mountedSlot = null;
      if (windowRef?.document === documentObject) {
        // The owner intentionally leaves page/window lifecycle to the Surface composition.
      }
    },
  });
}
