import { defineFirstPartyApp } from "../app-contract.mjs";

export const filesApp = defineFirstPartyApp({
  id: "files",
  title: "Arquivos",
  description: "Acesso ao espaço do usuário e a fontes de arquivos expostas por capacidades.",
  monogram: "AR",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "static",
      label: "Dados do usuário",
      title: "Seu espaço no OrdaX",
      body: "Arquivos e conteúdo pessoal pertencem ao usuário e permanecem separados do estado descartável do sistema.",
    },
    {
      kind: "capability",
      label: "Integração do host",
      title: "Arquivos escolhidos pelo usuário",
      body: "Quando disponível, o host pode oferecer seleção explícita de arquivos sem entregar acesso irrestrito ao sistema de arquivos.",
      capabilityId: "filesystem.user-selected",
    },
  ],
});
