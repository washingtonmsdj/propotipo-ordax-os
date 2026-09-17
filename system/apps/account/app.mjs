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
      kind: "identity-session",
      label: "Sessão",
      title: "Conta OrdaX",
      body: "A Surface apenas exibe o estado entregue pelo port de identidade. Nenhum provedor ou login é simulado quando o host não oferece autenticação real.",
    },
    {
      kind: "identity-actions",
      label: "Acesso",
      title: "Entrar e sair",
      body: "As ações aparecem somente quando o adapter autorizado declara suporte. O app não conhece Google, Microsoft, passkeys ou qualquer provedor específico.",
    },
    {
      kind: "static",
      label: "Núcleo local",
      title: "Continuidade preparada",
      body: `O protocolo compartilhado de sync e a fila offline estão ${SYNC_CORE_STATUS.protocolCore === "implemented" && SYNC_CORE_STATUS.offlineMutationQueue === "implemented" ? "implementados" : "indisponíveis"}. Identidade e transporte continuam dependentes de um host autorizado.`,
    },
    {
      kind: "capability",
      label: "Identidade",
      title: "Capacidade autenticada",
      body: "A capacidade account.identity só deve aparecer quando um adapter realmente fornece identidade autenticada.",
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
