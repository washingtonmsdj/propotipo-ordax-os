import { defineFirstPartyApp } from "../app-contract.mjs";

export const systemApp = defineFirstPartyApp({
  id: "system",
  title: "Sistema",
  description: "Entrega, atualizações, conectividade e recursos desta execução do OrdaX.",
  monogram: "SI",
  singleton: true,
  component: {
    version: "0.1.0",
    releaseMode: "bundled",
    criticality: "system",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "system/apps/system",
    dependencies: ["surface-shell", "update-service"],
  },
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
