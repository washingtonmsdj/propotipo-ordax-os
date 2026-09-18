(() => {
  "use strict";

  const CONFIG_PATH = "/config/public-site.json";
  const CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1";
  const CATALOG_SCHEMA = "prototype-ordax.public-release-catalog/1";

  function sameOriginPath(value) {
    return (
      typeof value === "string" &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("?") &&
      !value.includes("#")
    );
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

  function validIntegrityArtifact(value) {
    return (
      value &&
      sameOriginPath(value.href) &&
      validSha256(value.sha256) &&
      Number.isInteger(value.size) &&
      value.size > 0
    );
  }

  function releaseTargetNode(target) {
    if (
      !target ||
      !sameOriginPath(target.href) ||
      typeof target.label !== "string" ||
      !validSha256(target.sha256) ||
      !Number.isInteger(target.size) ||
      target.size <= 0
    ) {
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

  function complianceArtifactNode(label, artifact, actionLabel = "Abrir") {
    if (!validIntegrityArtifact(artifact)) return null;

    const row = document.createElement("div");
    row.className = "compliance-artifact";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const hash = document.createElement("code");
    const size = document.createElement("span");
    title.textContent = label;
    hash.textContent = `SHA-256 ${artifact.sha256}`;
    size.textContent = ` · ${artifact.size} bytes`;
    copy.append(title, document.createElement("br"), hash, size);

    const link = document.createElement("a");
    link.className = "button button-quiet";
    link.href = artifact.href;
    link.textContent = actionLabel;

    row.append(copy, link);
    return row;
  }

  function releaseComplianceNode(compliance) {
    if (!compliance || typeof compliance !== "object") return null;

    const entries = [
      ["SBOM", compliance.sbom, "SBOM"],
      ["Avisos e licenças de terceiros", compliance.third_party_notices, "Avisos"],
      ["Pacote de código-fonte aplicável", compliance.source_bundle, "Código-fonte"],
    ];

    const section = document.createElement("section");
    section.className = "release-compliance";

    const heading = document.createElement("div");
    heading.className = "release-compliance-heading";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "CONFORMIDADE DA RELEASE";
    const intro = document.createElement("p");
    intro.textContent = "Inventário, avisos e pacote de código-fonte vinculados aos mesmos bytes publicados.";
    heading.append(eyebrow, intro);
    section.append(heading);

    let count = 0;
    for (const [label, artifact, actionLabel] of entries) {
      const row = complianceArtifactNode(label, artifact, actionLabel);
      if (!row) continue;
      section.append(row);
      count += 1;
    }
    return count === entries.length ? section : null;
  }

  function validCatalog(catalog) {
    return (
      catalog &&
      catalog.$schema === CATALOG_SCHEMA &&
      Array.isArray(catalog.releases) &&
      (catalog.status === "empty" || catalog.status === "ready")
    );
  }

  function renderCatalog(catalog) {
    if (!validCatalog(catalog)) {
      throw new Error("invalid-public-release-catalog");
    }

    const list = document.querySelector("[data-release-list]");
    if (!list) return 0;
    list.replaceChildren();

    let rendered = 0;
    for (const release of catalog.releases) {
      if (!release || typeof release.version !== "string" || !Array.isArray(release.targets)) continue;

      const compliance = releaseComplianceNode(release.compliance);
      if (!compliance) continue;

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
        card.append(compliance);
        list.append(card);
        rendered += 1;
      }
    }
    return rendered;
  }

  function renderComplianceCatalog(catalog) {
    if (!validCatalog(catalog)) {
      throw new Error("invalid-public-release-catalog");
    }

    const list = document.querySelector("[data-compliance-list]");
    if (!list) return 0;
    list.replaceChildren();

    let rendered = 0;
    for (const release of catalog.releases) {
      if (!release || typeof release.version !== "string") continue;
      const compliance = releaseComplianceNode(release.compliance);
      if (!compliance) continue;

      const card = document.createElement("article");
      card.className = "release-card";

      const header = document.createElement("div");
      header.className = "release-card-header";
      const title = document.createElement("h2");
      title.textContent = release.version;
      const meta = document.createElement("p");
      const source = typeof release.source_commit === "string"
        ? `commit ${release.source_commit.slice(0, 12)}`
        : "release pública";
      meta.textContent = source;
      header.append(title, meta);
      card.append(header, compliance);
      list.append(card);
      rendered += 1;
    }
    return rendered;
  }

  function setStatus(selector, title, detail) {
    const status = document.querySelector(selector);
    if (!status) return;
    const strong = status.querySelector("strong");
    const paragraph = status.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;
  }

  async function loadPublicCatalog(config) {
    const catalogPath = config?.downloads?.catalog_url;
    if (!sameOriginPath(catalogPath)) {
      throw new Error("catalog-not-configured");
    }
    return loadJson(catalogPath);
  }

  async function initDownload(config) {
    try {
      const catalog = await loadPublicCatalog(config);
      const count = renderCatalog(catalog);
      if (count === 0) {
        setStatus(
          "[data-download-status]",
          "Nenhuma release pública disponível",
          "O catálogo está ativo, mas nenhuma release passou ainda pelos gates de integridade, publicação e conformidade."
        );
        return;
      }
      setStatus(
        "[data-download-status]",
        "Releases públicas verificadas",
        "Os downloads abaixo incluem integridade e material de conformidade vinculados à mesma release."
      );
    } catch {
      setStatus(
        "[data-download-status]",
        "Catálogo temporariamente indisponível",
        "Nenhum download será oferecido até a fonte autorizada de releases responder corretamente."
      );
    }
  }

  async function initCompliance(config) {
    try {
      const catalog = await loadPublicCatalog(config);
      const count = renderComplianceCatalog(catalog);
      if (count === 0) {
        setStatus(
          "[data-compliance-status]",
          "Nenhuma release pública ainda",
          "Quando a primeira release for autorizada, SBOM, avisos de terceiros e código-fonte aplicável aparecerão aqui."
        );
        return;
      }
      setStatus(
        "[data-compliance-status]",
        "Conformidade publicada por release",
        "Cada conjunto abaixo está vinculado por tamanho e SHA-256 à release pública correspondente."
      );
    } catch {
      setStatus(
        "[data-compliance-status]",
        "Catálogo de conformidade indisponível",
        "Nenhum material será anunciado até a fonte autorizada responder corretamente."
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
    } else if (page === "licencas") {
      await initCompliance(config);
    } else if (page === "login" || page === "cadastro") {
      renderIdentity(config);
    }
  }

  void start();
})();
