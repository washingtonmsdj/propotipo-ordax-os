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
      kind: "static",
      label: "Preferências",
      title: "Uma configuração, vários modos",
      body: "A Surface mantém a mesma semântica de preferências entre Web, Mobile, Desktop, USB e Native; diferenças de host entram por capacidades.",
    },
    {
      kind: "capabilities",
      label: "Host atual",
      title: "Capacidades declaradas",
      body: "A lista abaixo vem do contrato do host e não do nome da plataforma.",
    },
  ],
});
