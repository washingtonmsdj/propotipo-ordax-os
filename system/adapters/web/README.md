# Web Capability Adapter

Browser-safe implementation of OrdaX capability contracts.

This adapter may use browser APIs, authorized remote APIs or explicit unsupported-capability results. It does not own separate screens, CSS, design tokens or app forks.

`runtime.mjs` implements the platform-neutral `ordax.surface-host/1` boundary from `system/contracts/surface-host.mjs` and currently reports browser connectivity plus the available `network.https` capability.

`preferences.mjs` implements `ordax.preference-store/1` from `system/contracts/preference-store.mjs`. Browser storage is contained here: the shared app, Surface and preference service do not access `localStorage`. The adapter keeps a last-good in-memory snapshot and degrades to session-only behavior if browser storage is unavailable or denied. Corrupt persisted bytes are ignored instead of overriding validated preference semantics.

The Web preference store currently persists only the shared preference snapshot supplied by the Surface. It does not imply account sync, server backup or secure-secret storage.

This adapter deliberately does **not** claim that account or sync services are implemented merely because those capabilities belong to the Web product baseline. Runtime capability snapshots describe what the current host actually exposes.

`system/composition/web/` is responsible for wiring Web adapters to the shared Surface. Adapter modules never import the Surface.
