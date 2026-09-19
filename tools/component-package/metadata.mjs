import { getSystemComponent } from "../../system/apps/component-catalog.mjs";

const COMPONENT_ENTRYPOINTS = Object.freeze({
  internet: "system/apps/internet/runtime.mjs",
});

const componentId = process.argv[2] ?? "";
const entrypoint = COMPONENT_ENTRYPOINTS[componentId];
if (!entrypoint) {
  throw new Error(`Unsupported runtime component package: ${componentId || "<empty>"}`);
}

const component = getSystemComponent(componentId);
if (!component) {
  throw new Error(`Component manifest not found: ${componentId}`);
}

const runtimeUrl = new URL(`../../${entrypoint}`, import.meta.url);
const runtimeModule = await import(runtimeUrl);
const runtime = runtimeModule?.componentRuntime;
if (
  !runtime
  || runtime.componentId !== component.id
  || runtime.version !== component.version
) {
  throw new Error(
    `Runtime identity mismatch for ${componentId}: manifest=${component.version} runtime=${runtime?.version ?? "missing"}`,
  );
}

process.stdout.write(
  JSON.stringify({
    component: {
      id: component.id,
      title: component.title,
      kind: component.kind,
      version: component.version,
      releaseMode: component.releaseMode,
      criticality: component.criticality,
      failureDomain: component.failureDomain,
      restartScope: component.restartScope,
      healthMode: component.healthMode,
      owner: component.owner,
      dependencies: component.dependencies,
    },
    entrypoint,
  }) + "\n",
);
