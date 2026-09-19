import { defineComponentManifest } from "../../../contracts/component-manifest.mjs";

export const settingsComponent = defineComponentManifest({
  id: "settings",
  title: "Ajustes",
  kind: "app",
  version: "0.1.0",
  releaseMode: "bundled",
  criticality: "system",
  failureDomain: "app",
  restartScope: "surface",
  healthMode: "surface",
  owner: "system/apps/settings",
  dependencies: ["surface-shell", "network-service"],
});

export const accountComponent = defineComponentManifest({
  id: "account",
  title: "Conta",
  kind: "app",
  version: "0.1.0",
  releaseMode: "bundled",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "surface",
  healthMode: "surface",
  owner: "system/apps/account",
  dependencies: ["surface-shell"],
});

export const systemComponent = defineComponentManifest({
  id: "system",
  title: "Sistema",
  kind: "app",
  version: "0.1.0",
  releaseMode: "bundled",
  criticality: "system",
  failureDomain: "app",
  restartScope: "surface",
  healthMode: "surface",
  owner: "system/apps/system",
  dependencies: ["surface-shell", "update-service"],
});

export const appComponentManifests = Object.freeze([
  settingsComponent,
  accountComponent,
  systemComponent,
]);
