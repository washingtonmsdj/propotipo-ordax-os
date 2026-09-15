import { appearancePreference } from "../../services/preferences/appearance.mjs";
import { defineFirstPartyApp } from "../app-contract.mjs";

export const settingsApp = defineFirstPartyApp({
  id: "settings",
  title: "Configurações",
  description: "Preferências compartilhadas e capacidades realmente disponíveis neste dispositivo.",
  monogram: "CF",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "preference-choice",
      label: "Aparência",
      title: "Tema da Surface",
      body: "A preferência pertence ao produto compartilhado; cada host apenas persiste ou sincroniza quando essa capacidade existir.",
      preferenceId: appearancePreference.id,
      options: appearancePreference.options,
    },
    {
      kind: "capabilities",
      label: "Host atual",
      title: "Capacidades declaradas",
      body: "A lista abaixo vem do contrato do host e não do nome da plataforma.",
    },
  ],
});
