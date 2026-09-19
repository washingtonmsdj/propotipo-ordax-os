import { validateComponentManifests } from "../contracts/component-manifest.mjs";
import { appComponentManifests } from "../services/components/manifests/apps.mjs";
import { coreComponentManifests } from "../services/components/manifests/core.mjs";
import { internetComponent } from "./internet/component.mjs";

const COMPONENTS = validateComponentManifests([
  ...coreComponentManifests,
  ...appComponentManifests,
  internetComponent,
]);

const COMPONENT_BY_ID = new Map(
  COMPONENTS.map((component) => [component.id, component]),
);

export function listSystemComponents() {
  return COMPONENTS;
}

export function getSystemComponent(componentId) {
  return COMPONENT_BY_ID.get(componentId) ?? null;
}
