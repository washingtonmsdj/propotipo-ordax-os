const SURFACE_LOCALE = "pt-BR";
const SURFACE_TIME_ZONE = "America/Bahia";

const ICONS = Object.freeze({
  files: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 8.5v-3A1.5 1.5 0 0 1 5 4h4.3l2.2 2.5"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.6a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.6a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>`,
  account: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2.2A6.8 6.8 0 0 1 11.3 12h1.4a6.8 6.8 0 0 1 6.8 6.8V21z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>`,
  networkWifi: `<svg class="ordax-network-symbol ordax-network-symbol-wifi" viewBox="0 0 24 24" aria-hidden="true"><path class="ordax-wifi-arc ordax-wifi-arc-outer" d="M4 9.5a12 12 0 0 1 16 0"/><path class="ordax-wifi-arc ordax-wifi-arc-middle" d="M7 13a7.5 7.5 0 0 1 10 0"/><path class="ordax-wifi-arc ordax-wifi-arc-inner" d="M10 16.4a3 3 0 0 1 4 0"/><circle class="ordax-wifi-dot" cx="12" cy="19" r="1"/></svg>`,
  networkEthernet: `<svg class="ordax-network-symbol ordax-network-symbol-ethernet" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M8 15v4M16 15v4M8 19h8"/><path d="M9 9h6"/></svg>`,
  networkOther: `<svg class="ordax-network-symbol ordax-network-symbol-other" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 11l8-3M8 13l8 3"/></svg>`,
  battery: `<svg class="ordax-battery-symbol" viewBox="0 0 28 16" aria-hidden="true"><rect x="1.5" y="2" width="22" height="12" rx="2"/><path d="M25 6h1.5v4H25"/><rect class="ordax-battery-segment ordax-battery-segment-1" x="4" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-2" x="8.5" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-3" x="13" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-4" x="17.5" y="4.5" width="3.5" height="7" rx="0.8"/><path class="ordax-battery-bolt" d="m14.7 1.8-4 6.1h3l-1 6.3 4.5-7h-3z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>`,
});

function railButton(appId, label, icon) {
  return `
    <button type="button" class="ordax-rail-button" data-sidebar-app="${appId}" data-launch-app="${appId}" aria-label="Abrir ${label}">
      <span class="ordax-rail-icon">${icon}</span>
      <span>${label}</span>
    </button>`;
}

function spaceLink(label, target) {
  return `
    <button
      type="button"
      class="ordax-space-link"
      data-launch-app="files"
      data-app-target="${target}"
      data-requires-capability="filesystem.user-space"
      aria-label="Abrir ${label} em Arquivos"
    >
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
            <p class="ordax-area-kicker" data-area-kicker>Área 01</p>
            <h1 id="surface-home-title" class="ordax-clock"><time data-ordax-clock>--:--</time></h1>
            <p class="ordax-date" data-ordax-date>Carregando data…</p>

            <button type="button" class="ordax-command" data-launcher-toggle aria-expanded="false" aria-controls="ordax-launcher">
              <span class="ordax-command-icon">${ICONS.search}</span>
              <span class="ordax-command-copy">Abrir aplicativo…</span>
              <kbd>Ctrl + K</kbd>
            </button>

            <section class="ordax-space" aria-labelledby="ordax-space-title">
              <p id="ordax-space-title" class="ordax-section-kicker">Seu espaço</p>
              ${spaceLink("Documentos", "/Documentos")}
              ${spaceLink("Imagens", "/Imagens")}
              ${spaceLink("Downloads", "/Downloads")}
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
        <div class="ordax-area-switcher" data-area-switcher aria-label="Áreas de trabalho"></div>
        <div class="ordax-running-apps" data-running-apps aria-label="Aplicações abertas"></div>
        <div class="ordax-status-actions" data-update-slot></div>
        <div class="ordax-system-tray" aria-label="Estado do sistema">
          <button type="button" class="ordax-tray-item ordax-tray-network" data-connectivity-tray data-quick-panel-toggle="network" aria-expanded="false" aria-controls="ordax-quick-network" aria-label="Abrir acesso rápido de Wi-Fi">
            <span class="ordax-tray-icon ordax-tray-network-icon" data-connectivity-icon data-state="unknown" data-network-kind="unknown" data-signal-level="0" aria-hidden="true">${ICONS.networkWifi}${ICONS.networkEthernet}${ICONS.networkOther}</span>
            <span class="ordax-tray-label" data-connectivity-label>Conectividade desconhecida</span>
          </button>
          <button type="button" class="ordax-tray-item ordax-tray-battery" data-battery-tray data-quick-panel-toggle="battery" aria-expanded="false" aria-controls="ordax-quick-battery" aria-label="Abrir estado da bateria" hidden>
            <span class="ordax-tray-icon ordax-tray-battery-icon" data-battery-icon data-battery-level="0" data-charging="false" aria-hidden="true">${ICONS.battery}</span>
            <span class="ordax-tray-label" data-battery-label>--%</span>
          </button>
          <button type="button" class="ordax-tray-item ordax-tray-clock" data-quick-panel-toggle="datetime" aria-expanded="false" aria-controls="ordax-quick-datetime" title="Horário de Salvador/Bahia" aria-label="Abrir data e hora">
            <span class="ordax-tray-icon" aria-hidden="true">${ICONS.clock}</span>
            <time data-ordax-tray-clock>--:--</time>
          </button>
        </div>
      </footer>

      <div class="ordax-quick-panel-layer" data-quick-panel-layer>
        <section id="ordax-quick-network" class="ordax-quick-panel" data-quick-panel="network" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-network-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">Acesso rápido</span>
              <h2 id="ordax-quick-network-title">Wi-Fi</h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="Fechar acesso rápido de Wi-Fi">×</button>
          </header>
          <div class="ordax-quick-panel-content" data-quick-network-content>
            <p class="ordax-quick-empty">Lendo estado do Wi-Fi…</p>
          </div>
        </section>

        <section id="ordax-quick-battery" class="ordax-quick-panel ordax-quick-panel-battery" data-quick-panel="battery" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-battery-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">Energia</span>
              <h2 id="ordax-quick-battery-title">Bateria</h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="Fechar estado da bateria">×</button>
          </header>
          <div class="ordax-quick-battery-status" data-quick-battery-content>
            <strong data-quick-battery-percent>--%</strong>
            <span data-quick-battery-state>Lendo estado da bateria…</span>
          </div>
          <div class="ordax-quick-battery-power">
            <span>Fonte de energia</span>
            <strong data-quick-battery-power>Verificando…</strong>
          </div>
        </section>

        <section id="ordax-quick-datetime" class="ordax-quick-panel ordax-quick-panel-datetime" data-quick-panel="datetime" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-datetime-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">Data e hora</span>
              <h2 id="ordax-quick-datetime-title"><time data-ordax-quick-clock>--:--</time></h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="Fechar data e hora">×</button>
          </header>
          <p class="ordax-quick-date" data-ordax-quick-date>Carregando data…</p>
          <div class="ordax-quick-timezone">
            <span>Fuso horário</span>
            <strong>America/Bahia</strong>
          </div>
        </section>
      </div>
    </div>
  `;
}

function formatDate(date) {
  const formatter = new Intl.DateTimeFormat(SURFACE_LOCALE, {
    timeZone: SURFACE_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const value = formatter.format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function mountDesktopClock(root, clock = globalThis) {
  const timeNode = root.querySelector("[data-ordax-clock]");
  const trayTimeNode = root.querySelector("[data-ordax-tray-clock]");
  const quickTimeNode = root.querySelector("[data-ordax-quick-clock]");
  const dateNode = root.querySelector("[data-ordax-date]");
  const quickDateNode = root.querySelector("[data-ordax-quick-date]");
  if (!timeNode || !trayTimeNode || !quickTimeNode || !dateNode || !quickDateNode) {
    throw new Error("OrdaX desktop clock requires clock and date nodes");
  }

  const render = () => {
    const now = new Date();
    const formattedTime = new Intl.DateTimeFormat(SURFACE_LOCALE, {
      timeZone: SURFACE_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    timeNode.textContent = formattedTime;
    trayTimeNode.textContent = formattedTime;
    quickTimeNode.textContent = formattedTime;
    dateNode.textContent = formatDate(now);
    quickDateNode.textContent = new Intl.DateTimeFormat(SURFACE_LOCALE, {
      timeZone: SURFACE_TIME_ZONE,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
    const isoNow = now.toISOString();
    timeNode.setAttribute("datetime", isoNow);
    trayTimeNode.setAttribute("datetime", isoNow);
    quickTimeNode.setAttribute("datetime", isoNow);
    timeNode.title = "Horário de Salvador/Bahia";
    trayTimeNode.title = "Horário de Salvador/Bahia";
  };

  render();
  const timer = clock.setInterval(render, 30_000);
  return Object.freeze({
    destroy() {
      clock.clearInterval(timer);
    },
  });
}
