import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { INTERNET_VERSION } from "./version.mjs";

export const internetComponent = defineComponentManifest({
  id: "internet",
  title: "Internet",
  kind: "app",
  version: INTERNET_VERSION,
  releaseMode: "git-app",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "system/apps/internet",
  dependencies: ["surface-shell"],
});
