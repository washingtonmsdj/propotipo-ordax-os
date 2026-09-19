import { validateComponentManifests } from "../../contracts/component-manifest.mjs";
import { appComponentManifests } from "./manifests/apps.mjs";
import { coreComponentManifests } from "./manifests/core.mjs";

const COMPONENTS = validateComponentManifests([
  ...coreComponentManifests,
  ...appComponentManifests,
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
