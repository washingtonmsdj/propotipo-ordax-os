import { assertSurfaceHost } from "../../contracts/surface-host.mjs";
import { createSurfaceState, reduceSurfaceState } from "./surface-state.mjs";

const SHELL_MARKUP = `
  <div class="ordax-shell" data-ordax-shell>
    <header class="ordax-topbar">
      <div class="ordax-brand" aria-label="OrdaX">
        <span class="ordax-brand-mark" aria-hidden="true">O</span>
        <span>OrdaX</span>
      </div>
      <div class="ordax-status" role="status" aria-live="polite">
        <span class="ordax-status-dot" data-connectivity-dot aria-hidden="true"></span>
        <span data-connectivity-label>Conectividade desconhecida</span>
      </div>
    </header>

    <main class="ordax-workspace" tabindex="-1" data-workspace>
      <section class="ordax-view" data-view="home" aria-labelledby="surface-home-title">
        <p class="ordax-eyebrow">Surface compartilhada</p>
        <h1 id="surface-home-title">Uma base visual. Todos os modos.</h1>
        <p class="ordax-lead">
          Esta é a primeira camada gráfica executável da Surface do OrdaX. A interface é compartilhada;
          capacidades específicas entram por contratos, sem forks de produto.
        </p>
        <div class="ordax-card-grid">
          <article class="ordax-card">
            <span class="ordax-card-label">Runtime</span>
            <strong>Surface visual ativa</strong>
            <p>Sem framework obrigatório e sem dependência de serviço remoto para renderizar.</p>
          </article>
          <article class="ordax-card">
            <span class="ordax-card-label">Conectividade</span>
            <strong data-connectivity-card>Desconhecida</strong>
            <p>O estado vem do host por contrato e pode mudar sem recarregar a Surface.</p>
          </article>
          <article class="ordax-card">
            <span class="ordax-card-label">Capacidades disponíveis</span>
            <strong data-capability-count>0</strong>
            <p>A Surface reage a capacidades disponíveis, nunca ao nome da plataforma.</p>
          </article>
        </div>
      </section>

      <section class="ordax-view" data-view="system" aria-labelledby="surface-system-title" hidden>
        <p class="ordax-eyebrow">Sistema</p>
        <h1 id="surface-system-title">Contrato do host</h1>
        <p class="ordax-lead">Somente capacidades realmente expostas pelo host atual aparecem aqui.</p>
        <div class="ordax-panel">
          <h2>Capacidades</h2>
          <ul class="ordax-capability-list" data-capability-list></ul>
          <p class="ordax-empty" data-capability-empty>Nenhuma capacidade adicional foi declarada.</p>
        </div>
      </section>
    </main>

    <div class="ordax-launcher" data-launcher hidden>
      <div class="ordax-launcher-panel" role="menu" aria-label="Navegação OrdaX">
        <button type="button" role="menuitem" data-open-view="home">Início</button>
        <button type="button" role="menuitem" data-open-view="system">Sistema</button>
      </div>
    </div>

    <nav class="ordax-dock" aria-label="Controles da Surface">
      <button type="button" class="ordax-dock-button ordax-primary" data-launcher-toggle aria-expanded="false" aria-label="Abrir lançador">
        <span aria-hidden="true">O</span>
      </button>
      <button type="button" class="ordax-dock-button" data-open-view="home" aria-label="Abrir início">Início</button>
      <button type="button" class="ordax-dock-button" data-open-view="system" aria-label="Abrir sistema">Sistema</button>
    </nav>
  </div>
`;

const CONNECTIVITY_LABELS = {
  online: "Online",
  offline: "Offline",
  unknown: "Conectividade desconhecida",
};

export function mountSurface(root, host) {
  if (!(root instanceof Element)) {
    throw new TypeError("Surface root must be a DOM Element");
  }
  assertSurfaceHost(host);

  root.innerHTML = SHELL_MARKUP;
  let state = createSurfaceState(host.getSnapshot());

  const workspace = root.querySelector("[data-workspace]");
  const launcher = root.querySelector("[data-launcher]");
  const launcherToggle = root.querySelector("[data-launcher-toggle]");
  const capabilityList = root.querySelector("[data-capability-list]");
  const capabilityEmpty = root.querySelector("[data-capability-empty]");

  const render = () => {
    for (const view of root.querySelectorAll("[data-view]")) {
      view.hidden = view.dataset.view !== state.activeView;
    }

    launcher.hidden = !state.launcherOpen;
    launcherToggle.setAttribute("aria-expanded", String(state.launcherOpen));

    const connectivityLabel = CONNECTIVITY_LABELS[state.connectivity] ?? CONNECTIVITY_LABELS.unknown;
    root.querySelector("[data-connectivity-label]").textContent = connectivityLabel;
    root.querySelector("[data-connectivity-card]").textContent = connectivityLabel;
    root.querySelector("[data-connectivity-dot]").dataset.state = state.connectivity;
    root.querySelector("[data-capability-count]").textContent = String(state.capabilityIds.length);

    capabilityList.replaceChildren();
    for (const capabilityId of state.capabilityIds) {
      const item = document.createElement("li");
      item.textContent = capabilityId;
      capabilityList.append(item);
    }
    capabilityEmpty.hidden = state.capabilityIds.length > 0;
  };

  const dispatch = (action) => {
    const next = reduceSurfaceState(state, action);
    if (next === state) return;
    state = next;
    render();
  };

  const onClick = (event) => {
    const launcherButton = event.target.closest("[data-launcher-toggle]");
    if (launcherButton) {
      dispatch({ type: "launcher.toggle" });
      return;
    }

    const viewButton = event.target.closest("[data-open-view]");
    if (viewButton) {
      dispatch({ type: "view.open", view: viewButton.dataset.openView });
      workspace.focus({ preventScroll: true });
      return;
    }

    if (state.launcherOpen && !event.target.closest("[data-launcher]")) {
      dispatch({ type: "launcher.close" });
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape" && state.launcherOpen) {
      dispatch({ type: "launcher.close" });
      launcherToggle.focus();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribe = host.subscribe((snapshot) => dispatch({ type: "host.snapshot", snapshot }));
  render();

  return Object.freeze({
    destroy() {
      unsubscribe?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      root.replaceChildren();
    },
  });
}
