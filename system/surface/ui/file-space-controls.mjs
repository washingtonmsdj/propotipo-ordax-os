import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertFileSpacePort, validateFileListing } from "../../contracts/file-space.mjs";

const FILE_WINDOW_SELECTOR = '[data-window-id="files"]';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function joinPath(path, name) {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function parentPath(path) {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function mountFileSpaceControls(root, fileSpace = null, appActivation = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("File-space controls require a Surface root Element");
  }
  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  if (!port) {
    return Object.freeze({ destroy() {} });
  }

  let listing = null;
  let pending = false;
  let message = null;
  let destroyed = false;
  let requestOrdinal = 0;

  const renderPanel = () => {
    if (destroyed) return;
    const body = root.querySelector(`${FILE_WINDOW_SELECTOR} .ordax-window-body`);
    if (!body || body.querySelector("[data-ordax-file-space-panel]")) return;

    const section = element("section", "ordax-app-panel");
    section.dataset.ordaxFileSpacePanel = "";
    section.append(element("span", "ordax-app-panel-label", "Espaço do usuário"));
    section.append(element("h3", "ordax-app-panel-title", "Arquivos locais do OrdaX"));

    const status = element(
      "span",
      "ordax-inline-status",
      pending ? "Atualizando…" : listing ? listing.path : "Abrindo…",
    );
    status.dataset.state = pending ? "unknown" : "available";
    section.append(status);

    if (listing) {
      const navigation = element("div", "ordax-preference-choices");
      if (listing.path !== "/") {
        const up = element("button", "ordax-preference-choice", "← Voltar");
        up.type = "button";
        up.dataset.fileOpenPath = parentPath(listing.path);
        navigation.append(up);
      }
      const input = element("input");
      input.type = "text";
      input.maxLength = 120;
      input.placeholder = "Nome da nova pasta";
      input.autocomplete = "off";
      input.dataset.fileDirectoryName = "";
      input.setAttribute("aria-label", "Nome da nova pasta");
      navigation.append(input);
      const create = element("button", "ordax-preference-choice", "Criar pasta");
      create.type = "button";
      create.dataset.fileCreateDirectory = "";
      create.disabled = pending;
      navigation.append(create);
      section.append(navigation);

      if (listing.entries.length === 0) {
        section.append(element("p", "ordax-empty", "Esta pasta está vazia."));
      } else {
        const list = element("ul", "ordax-capability-list");
        for (const entry of listing.entries) {
          const item = element("li");
          if (entry.kind === "directory") {
            const button = element("button", "ordax-preference-choice", `📁 ${entry.name}`);
            button.type = "button";
            button.dataset.fileOpenPath = joinPath(listing.path, entry.name);
            item.append(button);
          } else {
            item.textContent = `📄 ${entry.name} · ${formatSize(entry.size)}`;
          }
          list.append(item);
        }
        section.append(list);
      }
    }

    if (message) {
      section.append(element("p", "ordax-empty", message));
    }
    section.append(
      element(
        "p",
        "ordax-app-panel-body",
        "Este painel só enxerga o espaço persistente do usuário do OrdaX; caminhos do sistema e links simbólicos ficam fora desta fronteira.",
      ),
    );
    body.append(section);
  };

  const replacePanel = () => {
    root.querySelector(`${FILE_WINDOW_SELECTOR} [data-ordax-file-space-panel]`)?.remove();
    renderPanel();
  };

  const load = async (path) => {
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replacePanel();
    try {
      const next = validateFileListing(await port.list(path));
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return;
      message = "Não foi possível abrir esta pasta.";
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replacePanel();
      }
    }
  };

  const createDirectory = async (name) => {
    const trimmed = String(name ?? "").trim();
    if (!listing || !trimmed) {
      message = "Digite um nome para a nova pasta.";
      replacePanel();
      return;
    }
    const ordinal = ++requestOrdinal;
    pending = true;
    message = null;
    replacePanel();
    try {
      const next = validateFileListing(await port.createDirectory(listing.path, trimmed));
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      message = `Pasta “${trimmed}” criada.`;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return;
      message = "A pasta não pôde ser criada. Verifique o nome ou se ela já existe.";
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replacePanel();
      }
    }
  };

  const onClick = (event) => {
    const open = event.target.closest("[data-file-open-path]");
    if (open && root.contains(open)) {
      void load(open.dataset.fileOpenPath);
      return;
    }
    const create = event.target.closest("[data-file-create-directory]");
    if (create && root.contains(create)) {
      const panel = create.closest("[data-ordax-file-space-panel]");
      const input = panel?.querySelector("[data-file-directory-name]");
      void createDirectory(input?.value);
    }
  };

  const observer = new MutationObserver(() => renderPanel());
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", onClick);
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (activation.appId === "files" && activation.target) {
      void load(activation.target);
    }
  });
  void load("/");

  return Object.freeze({
    destroy() {
      destroyed = true;
      requestOrdinal += 1;
      unsubscribeActivation?.();
      observer.disconnect();
      root.removeEventListener("click", onClick);
      root.querySelector(`${FILE_WINDOW_SELECTOR} [data-ordax-file-space-panel]`)?.remove();
    },
  });
}
