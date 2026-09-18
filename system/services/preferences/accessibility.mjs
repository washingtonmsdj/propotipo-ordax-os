export const ACCESSIBILITY_CONTRAST_PREFERENCE_ID = "accessibility.contrast";
export const ACCESSIBILITY_MOTION_PREFERENCE_ID = "accessibility.motion";
export const ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID = "accessibility.text-scale";

function choicePreference({
  id,
  title,
  description,
  defaultValue,
  options,
}) {
  const frozenOptions = Object.freeze(
    options.map((option) => Object.freeze({ ...option })),
  );
  const values = new Set(frozenOptions.map((option) => option.value));
  return Object.freeze({
    id,
    sectionId: "accessibility",
    label: "Acessibilidade",
    title,
    description,
    defaultValue,
    options: frozenOptions,
    validate(value) {
      if (!values.has(value)) {
        throw new TypeError(`Unsupported ${id}: ${String(value)}`);
      }
      return value;
    },
  });
}

export const accessibilityContrastPreference = choicePreference({
  id: ACCESSIBILITY_CONTRAST_PREFERENCE_ID,
  title: "Contraste",
  description:
    "Reforce separadores, texto secundário e foco dentro da Surface sem alterar o tema escolhido.",
  defaultValue: "standard",
  options: [
    { value: "standard", label: "Padrão" },
    { value: "high", label: "Reforçado" },
  ],
});

export const accessibilityMotionPreference = choicePreference({
  id: ACCESSIBILITY_MOTION_PREFERENCE_ID,
  title: "Movimento",
  description:
    "Reduza animações e transições não essenciais da Surface.",
  defaultValue: "standard",
  options: [
    { value: "standard", label: "Padrão" },
    { value: "reduced", label: "Reduzido" },
  ],
});


export const accessibilityTextScalePreference = choicePreference({
  id: ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID,
  title: "Tamanho do texto",
  description:
    "Aumente a escala tipográfica da Surface sem alterar o zoom do navegador ou do sistema.",
  defaultValue: "standard",
  options: [
    { value: "standard", label: "Padrão" },
    { value: "large", label: "Grande" },
    { value: "extra-large", label: "Muito grande" },
  ],
});
