import { defineFirstPartyApp } from "../app-contract.mjs";

export const internetApp = defineFirstPartyApp({
  id: "internet",
  title: "Internet",
  description: "Navegue, organize referências e conecte pesquisa ao seu trabalho.",
  monogram: "IN",
  singleton: true,
  component: {
    version: "0.1.0",
    releaseMode: "bundled",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "system/apps/internet",
    dependencies: ["surface-shell"],
  },
  requiredCapabilities: [],
  optionalCapabilities: ["browser.web-content"],
  panels: [
    {
      kind: "extension",
      extensionId: "internet-browser",
      label: "Navegador",
      title: "Internet",
      body: "A navegação integrada depende de um engine isolado fornecido pelo host.",
    },
  ],
});
