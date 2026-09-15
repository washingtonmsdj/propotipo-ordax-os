# Shared Preferences

`system/services/preferences/` owns user-facing preference semantics that are shared across OrdaX execution modes.

Preferences are distinct from runtime configuration, secrets and privileged host policy:

- runtime configuration controls product/release behavior and authority;
- preferences express user choices such as appearance;
- secrets remain behind secure platform storage;
- adapters may persist or synchronize a preference, but they do not redefine its meaning.

The first concrete preference is `appearance.theme` with `dark` and `light` values. The shared service validates values and exposes an immutable snapshot; the Surface renders and applies it. Persistence and account sync are intentionally not claimed by this baseline yet.

Unknown preference IDs are ignored by mutation helpers, while invalid values for known preferences fail closed. New preference semantics require an explicit owner and stable ID.
