import { defineFirstPartyApp } from "../app-contract.mjs";
import { internetComponent } from "./component.mjs";

export const internetApp = defineFirstPartyApp({
  id: "internet",
  title: "Internet",
  description: "Navegue, organize referências e conecte pesquisa ao seu trabalho.",
  monogram: "IN",
  singleton: true,
  component: internetComponent,
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
