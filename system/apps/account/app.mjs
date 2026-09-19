import { defineFirstPartyApp } from "../app-contract.mjs";

export const accountApp = defineFirstPartyApp({
  id: "account",
  title: "Conta",
  description: "Identidade, acesso e continuidade segura entre os modos do OrdaX.",
  monogram: "CO",
  singleton: true,
  component: {
    version: "0.1.0",
    releaseMode: "bundled",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "system/apps/account",
    dependencies: ["surface-shell"],
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "account-overview",
      label: "Conta",
      title: "Identidade e continuidade",
      body: "Este host não oferece uma integração de identidade para esta Surface.",
    },
  ],
});
