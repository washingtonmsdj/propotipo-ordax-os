import { defineFirstPartyApp } from "../app-contract.mjs";
import { accountComponent } from "../../services/components/manifests/apps.mjs";

export const accountApp = defineFirstPartyApp({
  id: "account",
  title: "Conta",
  description: "Identidade, acesso e continuidade segura entre os modos do OrdaX.",
  monogram: "CO",
  singleton: true,
  component: accountComponent,
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
