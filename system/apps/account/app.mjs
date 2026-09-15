import { SYNC_CORE_STATUS } from "../../services/sync/runtime.mjs";
import { defineFirstPartyApp } from "../app-contract.mjs";

export const accountApp = defineFirstPartyApp({
  id: "account",
  title: "Conta",
  description: "Identidade e continuidade de estado seguro entre os modos do OrdaX.",
  monogram: "CO",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "static",
      label: "Núcleo local",
      title: "Continuidade preparada",
      body: `O protocolo compartilhado de sync e a fila offline estão ${SYNC_CORE_STATUS.protocolCore === "implemented" && SYNC_CORE_STATUS.offlineMutationQueue === "implemented" ? "implementados" : "indisponíveis"}. Identidade e transporte continuam dependentes de um host autorizado.`,
    },
    {
      kind: "capability",
      label: "Identidade",
      title: "Conta OrdaX",
      body: "A sessão só se torna ativa quando o host realmente expõe identidade autenticada; o núcleo local não inventa login nem tokens.",
      capabilityId: "account.identity",
    },
    {
      kind: "capability",
      label: "Continuidade",
      title: "Sincronização segura",
      body: "Somente estado classificado como sincronizável pode acompanhar a conta; segredos de dispositivo permanecem locais.",
      capabilityId: "sync.safe-state",
    },
  ],
});
