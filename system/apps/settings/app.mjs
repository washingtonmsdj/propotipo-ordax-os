import { defineFirstPartyApp } from "../app-contract.mjs";

export const settingsApp = defineFirstPartyApp({
  id: "settings",
  title: "Ajustes",
  description: "Preferências compartilhadas, aparência e rede do OrdaX.",
  monogram: "AJ",
  singleton: true,
  component: {
    version: "0.1.0",
    releaseMode: "bundled",
    criticality: "system",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "system/apps/settings",
    dependencies: ["surface-shell", "network-service"],
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "settings-overview",
      label: "Ajustes",
      title: "Preferências do OrdaX",
      body: "As preferências desta Surface não estão disponíveis neste host.",
    },
  ],
});
