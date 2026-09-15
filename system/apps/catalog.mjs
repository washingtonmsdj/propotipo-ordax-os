const RAW_APPS = [
  {
    id: "files",
    title: "Arquivos",
    description: "Acesso ao espaço do usuário e a fontes de arquivos expostas por capacidades.",
    monogram: "AR",
    singleton: true,
    requiredCapabilities: [],
    panels: [
      {
        kind: "static",
        label: "Dados do usuário",
        title: "Seu espaço no OrdaX",
        body: "Arquivos e conteúdo pessoal pertencem ao usuário e permanecem separados do estado descartável do sistema.",
      },
      {
        kind: "capability",
        label: "Integração do host",
        title: "Arquivos escolhidos pelo usuário",
        body: "Quando disponível, o host pode oferecer seleção explícita de arquivos sem entregar acesso irrestrito ao sistema de arquivos.",
        capabilityId: "filesystem.user-selected",
      },
    ],
  },
  {
    id: "settings",
    title: "Configurações",
    description: "Preferências compartilhadas e capacidades realmente disponíveis neste dispositivo.",
    monogram: "CF",
    singleton: true,
    requiredCapabilities: [],
    panels: [
      {
        kind: "static",
        label: "Preferências",
        title: "Uma configuração, vários modos",
        body: "A Surface mantém a mesma semântica de preferências entre Web, Mobile, Desktop, USB e Native; diferenças de host entram por capacidades.",
      },
      {
        kind: "capabilities",
        label: "Host atual",
        title: "Capacidades declaradas",
        body: "A lista abaixo vem do contrato do host e não do nome da plataforma.",
      },
    ],
  },
  {
    id: "account",
    title: "Conta",
    description: "Identidade e continuidade de estado seguro entre os modos do OrdaX.",
    monogram: "CO",
    singleton: true,
    requiredCapabilities: [],
    panels: [
      {
        kind: "capability",
        label: "Identidade",
        title: "Conta OrdaX",
        body: "Quando a identidade estiver implementada pelo host, esta mesma aplicação será o ponto compartilhado de sessão e perfil.",
        capabilityId: "account.identity",
      },
      {
        kind: "capability",
        label: "Continuidade",
        title: "Sincronização segura",
        body: "Somente estado classificado como sincronizável pode acompanhar a conta; segredos de dispositivo permanecem locais.",
        capabilityId: "sync.safe-state",
      },
    ],
  },
  {
    id: "system",
    title: "Sistema",
    description: "Estado do host, conectividade e envelope de capacidades desta execução.",
    monogram: "SI",
    singleton: true,
    requiredCapabilities: [],
    panels: [
      {
        kind: "connectivity",
        label: "Rede",
        title: "Conectividade do host",
        body: "O estado é atualizado pelo adapter através do contrato da Surface.",
      },
      {
        kind: "capabilities",
        label: "Contrato",
        title: "Capacidades ativas",
        body: "Capacidades ausentes são tratadas como indisponíveis; a Surface não tenta adivinhar a plataforma.",
      },
    ],
  },
];

function freezePanel(panel) {
  return Object.freeze({ ...panel });
}

function freezeApp(app) {
  if (!/^[a-z][a-z0-9-]*$/.test(app.id)) {
    throw new TypeError(`Invalid first-party app id: ${String(app.id)}`);
  }
  if (!app.title || !app.description || !app.monogram) {
    throw new TypeError(`First-party app ${app.id} is missing display metadata`);
  }
  if (!Array.isArray(app.requiredCapabilities) || !Array.isArray(app.panels)) {
    throw new TypeError(`First-party app ${app.id} has an invalid contract`);
  }
  return Object.freeze({
    ...app,
    requiredCapabilities: Object.freeze([...app.requiredCapabilities]),
    panels: Object.freeze(app.panels.map(freezePanel)),
  });
}

const APPS = Object.freeze(RAW_APPS.map(freezeApp));
const APP_BY_ID = new Map(APPS.map((app) => [app.id, app]));

if (APP_BY_ID.size !== APPS.length) {
  throw new TypeError("First-party app ids must be unique");
}

export function listFirstPartyApps() {
  return APPS;
}

export function getFirstPartyApp(appId) {
  return APP_BY_ID.get(appId) ?? null;
}

export function isAppAvailable(app, capabilityIds) {
  if (!app) return false;
  const available = new Set(capabilityIds);
  return app.requiredCapabilities.every((capabilityId) => available.has(capabilityId));
}
