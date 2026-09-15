export const APPEARANCE_PREFERENCE_ID = "appearance.theme";

const RAW_OPTIONS = [
  { value: "dark", label: "Escuro" },
  { value: "light", label: "Claro" },
];

const OPTIONS = Object.freeze(RAW_OPTIONS.map((option) => Object.freeze({ ...option })));
const VALUES = new Set(OPTIONS.map((option) => option.value));

export const appearancePreference = Object.freeze({
  id: APPEARANCE_PREFERENCE_ID,
  defaultValue: "dark",
  options: OPTIONS,
  validate(value) {
    if (!VALUES.has(value)) {
      throw new TypeError(`Unsupported appearance theme: ${String(value)}`);
    }
    return value;
  },
});
