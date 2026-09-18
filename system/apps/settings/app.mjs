import { defineFirstPartyApp } from "../app-contract.mjs";

export const settingsApp = defineFirstPartyApp({
  id: "settings",
  title: "Ajustes",
  description: "Preferências compartilhadas, aparência e capacidades desta execução.",
  monogram: "AJ",
  singleton: true,
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
