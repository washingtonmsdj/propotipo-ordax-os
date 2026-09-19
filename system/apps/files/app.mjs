import { defineFirstPartyApp } from "../app-contract.mjs";
import { filesComponent } from "./component.mjs";

export const filesApp = defineFirstPartyApp({
  id: "files",
  title: "Arquivos",
  description: "Organize documentos, imagens, downloads e conteúdo persistente do usuário.",
  monogram: "AR",
  singleton: true,
  component: filesComponent,
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
