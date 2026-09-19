import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { FILES_VERSION } from "./version.mjs";

export const filesComponent = defineComponentManifest({
  id: "files",
  title: "Arquivos",
  kind: "app",
  version: FILES_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/files",
  dependencies: ["surface-shell"],
});
