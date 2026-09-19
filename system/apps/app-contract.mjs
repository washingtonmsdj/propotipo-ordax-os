import { defineComponentManifest } from "../contracts/component-manifest.mjs";

const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const PANEL_KINDS = new Set([
  "static",
  "capability",
  "capabilities",
  "connectivity",
  "preference-choice",
  "extension",
]);

function freezeCapabilities(appId, label, values) {
  if (!Array.isArray(values)) {
    throw new TypeError(`First-party app ${appId} has invalid ${label} capabilities`);
  }
  const capabilities = [...values];
  if (
    capabilities.some((capabilityId) => typeof capabilityId !== "string" || !capabilityId)
    || new Set(capabilities).size !== capabilities.length
  ) {
    throw new TypeError(`First-party app ${appId} has invalid ${label} capabilities`);
  }
  return Object.freeze(capabilities);
}

function freezeChoiceOptions(appId, panel) {
  if (!panel.preferenceId || !Array.isArray(panel.options) || panel.options.length === 0) {
    throw new TypeError(`First-party app ${appId} preference panel is invalid`);
  }
  const values = new Set();
  return Object.freeze(
    panel.options.map((option) => {
      if (!option || typeof option.value !== "string" || !option.value || !option.label) {
        throw new TypeError(`First-party app ${appId} preference option is invalid`);
      }
      if (values.has(option.value)) {
        throw new TypeError(`First-party app ${appId} preference option values must be unique`);
      }
      values.add(option.value);
      return Object.freeze({ value: option.value, label: option.label });
    })
  );
}

function freezePanel(appId, panel) {
  if (!panel || typeof panel !== "object") {
    throw new TypeError(`First-party app ${appId} has an invalid panel`);
  }
  if (!PANEL_KINDS.has(panel.kind)) {
    throw new TypeError(`First-party app ${appId} has an unsupported panel kind: ${String(panel.kind)}`);
  }
  if (!panel.label || !panel.title) {
    throw new TypeError(`First-party app ${appId} panel is missing display metadata`);
  }
  if (panel.kind === "capability" && !panel.capabilityId) {
    throw new TypeError(`First-party app ${appId} capability panel is missing capabilityId`);
  }
  if (
    panel.kind === "extension" &&
    (typeof panel.extensionId !== "string" || !APP_ID_RE.test(panel.extensionId))
  ) {
    throw new TypeError(`First-party app ${appId} extension panel is missing a valid extensionId`);
  }
  const frozen = { ...panel };
  if (panel.kind === "preference-choice") {
    frozen.options = freezeChoiceOptions(appId, panel);
  }
  return Object.freeze(frozen);
}

export function defineFirstPartyApp(spec) {
  if (!spec || typeof spec !== "object") {
    throw new TypeError("First-party app definition must be an object");
  }
  if (!APP_ID_RE.test(spec.id ?? "")) {
    throw new TypeError(`Invalid first-party app id: ${String(spec.id)}`);
  }
  if (!spec.title || !spec.description || !spec.monogram) {
    throw new TypeError(`First-party app ${spec.id} is missing display metadata`);
  }
  if (!Array.isArray(spec.requiredCapabilities) || !Array.isArray(spec.panels)) {
    throw new TypeError(`First-party app ${spec.id} has an invalid contract`);
  }
  const requiredCapabilities = freezeCapabilities(
    spec.id,
    "required",
    spec.requiredCapabilities,
  );
  const optionalCapabilities = freezeCapabilities(
    spec.id,
    "optional",
    spec.optionalCapabilities ?? [],
  );
  const requiredSet = new Set(requiredCapabilities);
  if (optionalCapabilities.some((capabilityId) => requiredSet.has(capabilityId))) {
    throw new TypeError(
      `First-party app ${spec.id} cannot require and optionally consume the same capability`,
    );
  }
  if (!spec.component || typeof spec.component !== "object" || Array.isArray(spec.component)) {
    throw new TypeError(`First-party app ${spec.id} is missing component identity`);
  }
  const component = defineComponentManifest({
    ...spec.component,
    id: spec.id,
    title: spec.title,
    kind: "app",
  });

  return Object.freeze({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    monogram: spec.monogram,
    singleton: spec.singleton !== false,
    component,
    requiredCapabilities,
    optionalCapabilities,
    panels: Object.freeze(spec.panels.map((panel) => freezePanel(spec.id, panel))),
  });
}

export function isAppAvailable(app, capabilityIds) {
  if (!app) return false;
  const available = new Set(capabilityIds);
  return app.requiredCapabilities.every((capabilityId) => available.has(capabilityId));
}
