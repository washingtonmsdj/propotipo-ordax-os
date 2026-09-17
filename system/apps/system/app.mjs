import { defineFirstPartyApp } from "../app-contract.mjs";

export const systemApp = defineFirstPartyApp({
  id: "system",
  title: "Sistema",
  description: "Estado do host, conectividade e envelope de capacidades desta execução.",
  monogram: "SI",
  singleton: true,
  requiredCapabilities: [],
  panels: [
    {
      kind: "connectivity",
      label: "Rede",
      title: "Conectividade do host",
      body: "O estado é atualizado pelo adapter através do contrato da Surface.",
    },
    {
      kind: "capabilities",
      label: "Contrato",
      title: "Capacidades ativas",
      body: "Capacidades ausentes são tratadas como indisponíveis; a Surface não tenta adivinhar a plataforma.",
    },
    {
      kind: "power-actions",
      label: "Energia",
      title: "Reiniciar ou desligar",
      body: "As ações só aparecem quando o host fornece o contrato de energia e exigem confirmação explícita.",
    },
  ],
});
