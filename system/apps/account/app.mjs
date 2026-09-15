import { defineFirstPartyApp } from "../app-contract.mjs";

export const accountApp = defineFirstPartyApp({
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
});
