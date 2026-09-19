import { defineFirstPartyApp } from "../app-contract.mjs";

export const filesApp = defineFirstPartyApp({
  id: "files",
  title: "Arquivos",
  description: "Organize documentos, imagens, downloads e conteúdo persistente do usuário.",
  monogram: "AR",
  singleton: true,
  component: {
    version: "0.1.0",
    releaseMode: "bundled",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "surface",
    healthMode: "surface",
    owner: "system/apps/files",
    dependencies: ["surface-shell"],
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "file-space",
      label: "Espaço do usuário",
      title: "Arquivos",
      body: "Este host não expõe um espaço local de arquivos para esta Surface.",
    },
  ],
});
