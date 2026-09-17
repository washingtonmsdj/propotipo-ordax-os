const ICONS = Object.freeze({
  files: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 8.5v-3A1.5 1.5 0 0 1 5 4h4.3l2.2 2.5"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.6a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.6a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>`,
  account: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2.2A6.8 6.8 0 0 1 11.3 12h1.4a6.8 6.8 0 0 1 6.8 6.8V21z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>`,
});

function railButton(appId, label, icon) {
  return `
    <button type="button" class="ordax-rail-button" data-sidebar-app="${appId}" data-launch-app="${appId}" aria-label="Abrir ${label}">
      <span class="ordax-rail-icon">${icon}</span>
      <span>${label}</span>
    </button>`;
}

function spaceLink(label) {
  return `
    <button type="button" class="ordax-space-link" data-launch-app="files" aria-label="Abrir ${label} em Arquivos">
      <span class="ordax-space-icon">${ICONS.folder}</span>
      <span>${label}</span>
      <span class="ordax-space-arrow">${ICONS.arrow}</span>
    </button>`;
}

export function createDesktopShellMarkup() {
  return `
    <div class="ordax-shell" data-ordax-shell>
      <aside class="ordax-rail" aria-label="Aplicativos principais">
        <nav class="ordax-rail-nav">
          ${railButton("files", "Arquivos", ICONS.files)}
          ${railButton("settings", "Ajustes", ICONS.settings)}
          ${railButton("account", "Conta", ICONS.account)}
          ${railButton("system", "Sistema", ICONS.system)}
        </nav>
        <div class="ordax-power-slot" data-power-slot></div>
      </aside>

      <main class="ordax-workspace" tabindex="-1" data-workspace>
        <header class="ordax-brandbar">
          <div class="ordax-brand" aria-label="OrdaX">
            <span class="ordax-brand-symbol" aria-hidden="true">
              <span class="ordax-brand-dot"></span>
              <span class="ordax-brand-slash"></span>
            </span>
            <span class="ordax-brand-word">OrdaX</span>
          </div>
          <span class="ordax-brand-rule" aria-hidden="true"></span>
        </header>

        <section class="ordax-desktop" aria-labelledby="surface-home-title">
          <div class="ordax-home-panel">
            <p class="ordax-area-kicker">Área 01</p>
            <h1 id="surface-home-title" class="ordax-clock" data-ordax-clock>--:--</h1>
            <p class="ordax-date" data-ordax-date>Carregando data…</p>

            <button type="button" class="ordax-command" data-launcher-toggle aria-expanded="false" aria-controls="ordax-launcher">
              <span class="ordax-command-icon">${ICONS.search}</span>
              <span class="ordax-command-copy">Abrir aplicativo…</span>
              <kbd>Ctrl + K</kbd>
            </button>

            <section class="ordax-space" aria-labelledby="ordax-space-title">
              <p id="ordax-space-title" class="ordax-section-kicker">Seu espaço</p>
              ${spaceLink("Documentos")}
              ${spaceLink("Imagens")}
              ${spaceLink("Downloads")}
            </section>
          </div>

          <div class="ordax-identity-art" aria-hidden="true">
            <span class="ordax-art-sun"></span>
            <span class="ordax-art-arc"></span>
            <span class="ordax-art-slab ordax-art-slab-a"></span>
            <span class="ordax-art-slab ordax-art-slab-b"></span>
            <span class="ordax-art-slab ordax-art-slab-c"></span>
            <span class="ordax-art-vertical"></span>
            <span class="ordax-art-caption">IDEIAS<br>ORGANIZAM<br>REALIDADES</span>
          </div>
        </section>

        <div class="ordax-window-layer" data-window-layer aria-live="polite"></div>
      </main>

      <div id="ordax-launcher" class="ordax-launcher" data-launcher hidden>
        <div class="ordax-launcher-panel" role="dialog" aria-modal="false" aria-label="Abrir aplicativo">
          <label class="ordax-launcher-search">
            <span class="ordax-command-icon">${ICONS.search}</span>
            <input type="search" data-launcher-query autocomplete="off" spellcheck="false" placeholder="Pesquisar aplicativos" aria-label="Pesquisar aplicativos">
            <kbd>Esc</kbd>
          </label>
          <div class="ordax-launcher-grid" data-app-launcher></div>
        </div>
      </div>

      <footer class="ordax-dock ordax-statusbar" aria-label="Estado e áreas da Surface">
        <div class="ordax-area-switcher" aria-label="Áreas de trabalho">
          <button type="button" class="ordax-area-button" data-show-desktop data-active="true" aria-current="true">
            <span class="ordax-area-dot" aria-hidden="true"></span>Área 01
          </button>
          <button type="button" class="ordax-area-button" disabled title="Áreas múltiplas entram na próxima etapa">02</button>
          <button type="button" class="ordax-area-button ordax-area-add" disabled title="Áreas múltiplas entram na próxima etapa">+</button>
        </div>
        <div class="ordax-running-apps" data-running-apps aria-label="Aplicações abertas"></div>
        <div class="ordax-status-actions" data-update-slot></div>
        <div class="ordax-status" role="status" aria-live="polite">
          <span class="ordax-status-dot" data-connectivity-dot aria-hidden="true"></span>
          <span data-connectivity-label>Conectividade desconhecida</span>
        </div>
      </footer>
    </div>
  `;
}

function formatDate(date) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const value = formatter.format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function mountDesktopClock(root, clock = globalThis) {
  const timeNode = root.querySelector("[data-ordax-clock]");
  const dateNode = root.querySelector("[data-ordax-date]");
  if (!timeNode || !dateNode) {
    throw new Error("OrdaX desktop clock requires clock and date nodes");
  }

  const render = () => {
    const now = new Date();
    timeNode.textContent = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    dateNode.textContent = formatDate(now);
    timeNode.setAttribute("datetime", now.toISOString());
  };

  render();
  const timer = clock.setInterval(render, 30_000);
  return Object.freeze({
    destroy() {
      clock.clearInterval(timer);
    },
  });
}
