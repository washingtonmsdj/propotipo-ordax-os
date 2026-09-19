import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { NOTES_VERSION } from "./version.mjs";

export const notesComponent = defineComponentManifest({
  id: "notes",
  title: "Notas",
  kind: "app",
  version: NOTES_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/notes",
  dependencies: ["surface-shell"],
});
