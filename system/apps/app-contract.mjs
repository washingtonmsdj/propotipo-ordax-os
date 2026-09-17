const APP_ID_RE = /^[a-z][a-z0-9-]*$/;
const PANEL_KINDS = new Set([
  "static",
  "capability",
  "capabilities",
  "connectivity",
  "identity-session",
  "identity-actions",
  "preference-choice",
]);

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
  const requiredCapabilities = [...spec.requiredCapabilities];
  if (
    requiredCapabilities.some((capabilityId) => typeof capabilityId !== "string" || !capabilityId) ||
    new Set(requiredCapabilities).size !== requiredCapabilities.length
  ) {
    throw new TypeError(`First-party app ${spec.id} has invalid required capabilities`);
  }
  return Object.freeze({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    monogram: spec.monogram,
    singleton: spec.singleton !== false,
    requiredCapabilities: Object.freeze(requiredCapabilities),
    panels: Object.freeze(spec.panels.map((panel) => freezePanel(spec.id, panel))),
  });
}

export function isAppAvailable(app, capabilityIds) {
  if (!app) return false;
  const available = new Set(capabilityIds);
  return app.requiredCapabilities.every((capabilityId) => available.has(capabilityId));
}
