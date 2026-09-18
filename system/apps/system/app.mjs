import { defineFirstPartyApp } from "../app-contract.mjs";

export const systemApp = defineFirstPartyApp({
  id: "system",
  title: "Sistema",
  description: "Entrega, atualizações, conectividade e recursos desta execução do OrdaX.",
  monogram: "SI",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "system-overview",
      label: "Sistema",
      title: "Visão geral",
      body: "O estado detalhado do sistema não está disponível neste host.",
    },
  ],
});
