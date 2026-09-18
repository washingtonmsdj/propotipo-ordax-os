(() => {
  "use strict";

  const CONFIG_PATH = "/config/public-site.json";
  const CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1";
  const CATALOG_SCHEMA = "prototype-ordax.public-release-catalog/1";

  function sameOriginPath(value) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
  }

  async function loadJson(path) {
    const response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("resource-unavailable");
    }
    return response.json();
  }

  async function loadConfig() {
    const config = await loadJson(CONFIG_PATH);
    if (!config || config.$schema !== CONFIG_SCHEMA) {
      throw new Error("invalid-public-site-config");
    }
    return config;
  }

  function identityCopy(kind, available) {
    if (available) {
      return kind === "login"
        ? ["Acesso disponível", "Continue para o serviço seguro de identidade OrdaX."]
        : ["Cadastro disponível", "Continue para o serviço seguro de criação da conta OrdaX."];
    }
    return kind === "login"
      ? ["Serviço de identidade ainda não configurado", "Quando a integração for ativada, o acesso será encaminhado ao owner real de identidade e sessão."]
      : ["Cadastro ainda não configurado", "O botão será habilitado somente quando existir um endpoint de identidade aprovado para o portal."];
  }

  function renderIdentity(config) {
    const state = document.querySelector("[data-identity-state]");
    const action = document.querySelector("[data-identity-action]");
    if (!state || !action) return;

    const kind = action.dataset.identityAction;
    const target = kind === "login"
      ? config?.identity?.login_url
      : config?.identity?.register_url;
    const available = sameOriginPath(target);
    const [title, detail] = identityCopy(kind, available);

    const strong = state.querySelector("strong");
    const paragraph = state.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;

    if (available) {
      action.href = target;
      action.hidden = false;
    } else {
      action.removeAttribute("href");
      action.hidden = true;
    }
  }

  function validSha256(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  }

  function releaseTargetNode(target) {
    if (!target || !sameOriginPath(target.href) || typeof target.label !== "string" || !validSha256(target.sha256)) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "release-target";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const hash = document.createElement("code");
    title.textContent = target.label;
    hash.textContent = `SHA-256 ${target.sha256}`;
    copy.append(title, document.createElement("br"), hash);

    const link = document.createElement("a");
    link.className = "button button-primary";
    link.href = target.href;
    link.textContent = "Baixar";

    row.append(copy, link);
    return row;
  }

  function renderCatalog(catalog) {
    if (!catalog || catalog.$schema !== CATALOG_SCHEMA || !Array.isArray(catalog.releases)) {
      throw new Error("invalid-public-release-catalog");
    }

    const list = document.querySelector("[data-release-list]");
    if (!list) return 0;
    list.replaceChildren();

    let rendered = 0;
    for (const release of catalog.releases) {
      if (!release || typeof release.version !== "string" || !Array.isArray(release.targets)) continue;

      const card = document.createElement("article");
      card.className = "release-card";

      const header = document.createElement("div");
      header.className = "release-card-header";
      const title = document.createElement("h2");
      title.textContent = release.version;
      const meta = document.createElement("p");
      const channel = typeof release.channel === "string" ? release.channel : "public";
      const date = typeof release.published_at === "string" ? ` · ${release.published_at}` : "";
      meta.textContent = `${channel}${date}`;
      header.append(title, meta);
      card.append(header);

      let targetCount = 0;
      for (const target of release.targets) {
        const row = releaseTargetNode(target);
        if (!row) continue;
        card.append(row);
        targetCount += 1;
      }

      if (targetCount > 0) {
        list.append(card);
        rendered += 1;
      }
    }
    return rendered;
  }

  function setDownloadStatus(title, detail) {
    const status = document.querySelector("[data-download-status]");
    if (!status) return;
    const strong = status.querySelector("strong");
    const paragraph = status.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;
  }

  async function initDownload(config) {
    const catalogPath = config?.downloads?.catalog_url;
    if (!sameOriginPath(catalogPath)) {
      setDownloadStatus(
        "Downloads públicos ainda não foram publicados",
        "Nenhum catálogo de releases autorizadas está configurado para esta fase do protótipo."
      );
      return;
    }

    try {
      const catalog = await loadJson(catalogPath);
      const count = renderCatalog(catalog);
      if (count === 0) {
        setDownloadStatus(
          "Nenhuma release pública disponível",
          "O catálogo existe, mas ainda não contém uma release autorizada com artefatos verificáveis."
        );
        return;
      }
      setDownloadStatus(
        "Releases públicas verificadas",
        "Os links abaixo vieram do catálogo de releases autorizado pelo pipeline OrdaX."
      );
    } catch {
      setDownloadStatus(
        "Catálogo temporariamente indisponível",
        "Nenhum download será oferecido até a fonte autorizada de releases responder corretamente."
      );
    }
  }

  async function start() {
    let config = null;
    try {
      config = await loadConfig();
    } catch {
      config = null;
    }

    const page = document.body?.dataset?.page;
    if (page === "download") {
      await initDownload(config);
    } else if (page === "login" || page === "cadastro") {
      renderIdentity(config);
    }
  }

  void start();
})();
