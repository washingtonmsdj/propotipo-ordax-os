import { defineFirstPartyApp } from "../app-contract.mjs";

export const settingsApp = defineFirstPartyApp({
  id: "settings",
  title: "Configurações",
  description: "Preferências compartilhadas, aparência e capacidades desta execução.",
  monogram: "CF",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "settings-overview",
      label: "Configurações",
      title: "Preferências do OrdaX",
      body: "As preferências desta Surface não estão disponíveis neste host.",
    },
  ],
});
