import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { FILES_VERSION } from "./version.mjs";
import { mountFileSpaceControls } from "./ui/file-space-controls.mjs";

const FILES_STYLESHEET_URL = new URL("./files.css", import.meta.url).href;
const FILES_STYLE_SELECTOR = 'link[data-ordax-component-style="files"]';

async function mountFilesStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Files runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(FILES_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== FILES_STYLESHEET_URL) {
      throw new TypeError("Files component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = FILES_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "files";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Files component stylesheet failed to load")),
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
  componentId: "files",
  version: FILES_VERSION,
  async mount({
    root,
    fileSpace = null,
    appActivation = null,
    surfaceLifecycle,
    recentFiles = null,
    projects = null,
    notesFileImporter = null,
  } = {}) {
    // A host without a file-space capability keeps the Surface fallback panel.
    if (fileSpace === null) {
      return Object.freeze({ destroy() {} });
    }

    const releaseStyles = await mountFilesStyles(root);
    let controls = null;
    try {
      controls = mountFileSpaceControls(
        root,
        fileSpace,
        appActivation,
        surfaceLifecycle,
        { recentFiles, projects, notesFileImporter },
      );
      let destroyed = false;
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          controls?.destroy();
          releaseStyles();
        },
      });
    } catch (error) {
      controls?.destroy();
      releaseStyles();
      throw error;
    }
  },
});
