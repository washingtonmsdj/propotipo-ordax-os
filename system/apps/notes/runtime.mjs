import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { NOTES_VERSION } from "./version.mjs";
import { createNotesRuntime } from "./domain/runtime.mjs";
import { mountNotesWorkspaceControls } from "./ui/workspace-controls.mjs";

const NOTES_STYLESHEET_URL = new URL("./notes.css", import.meta.url).href;
const NOTES_STYLE_SELECTOR = 'link[data-ordax-component-style="notes"]';

async function mountNotesStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Notes runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(NOTES_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== NOTES_STYLESHEET_URL) {
      throw new TypeError("Notes component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = NOTES_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "notes";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Notes component stylesheet failed to load")),
      { once: true },
    );
  });

  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "notes",
  version: NOTES_VERSION,
  async mount({
    root,
    createStore = null,
    surfaceLifecycle,
    fileSpace = null,
    appActivation = null,
  } = {}) {
    if (createStore !== null && typeof createStore !== "function") {
      throw new TypeError("Notes createStore must be a function or null");
    }
    const releaseStyles = await mountNotesStyles(root);
    let notesRuntime = null;
    let controls = null;

    const cleanup = () => {
      controls?.destroy();
      notesRuntime?.destroy();
      releaseStyles();
    };

    try {
      const store = createStore?.() ?? null;
      notesRuntime = createNotesRuntime({ store });
      controls = mountNotesWorkspaceControls(
        root,
        notesRuntime,
        surfaceLifecycle,
        { fileSpace, appActivation },
      );

      let destroyed = false;
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          cleanup();
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  },
});
