import { defineFirstPartyApp } from "../app-contract.mjs";

export const browserApp = defineFirstPartyApp({
  id: "browser",
  title: "Navegador",
  description: "Navegação web segura dentro do espaço de trabalho OrdaX.",
  monogram: "NV",
  singleton: true,
  requiredCapabilities: ["network.https"],
  optionalCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "browser-workspace",
      label: "Navegador",
      title: "Navegador",
      body: "O espaço de navegação não está disponível nesta composição.",
    },
  ],
});
