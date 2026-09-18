# Web Capability Adapter

Browser-safe implementation of OrdaX capability contracts.

This adapter may use browser APIs, authorized remote APIs or explicit unsupported-capability results. It does not own separate screens, CSS, design tokens or app forks.

`runtime.mjs` implements the platform-neutral `ordax.surface-host/1` boundary from `system/contracts/surface-host.mjs` and currently reports browser connectivity plus the available `network.https` capability.

`preferences.mjs` implements `ordax.preference-store/1` from `system/contracts/preference-store.mjs`. Browser storage is contained here: the shared app, Surface and preference service do not access `localStorage`. The adapter keeps a last-good in-memory snapshot and degrades to session-only behavior if browser storage is unavailable or denied. Corrupt persisted bytes are ignored instead of overriding validated preference semantics.

`diagnostic-journal-store.mjs` implements `ordax.diagnostic-journal-store/1` with the dedicated `ordax.diagnostic-journal.v1` browser key. It reports `device` scope only when a complete Storage capability is available; otherwise it provides an honest session-only store. When persistent browser storage exists, read/write/quota failures are surfaced to the shared diagnostics runtime instead of being silently converted into successful durability. The shared runtime owns recovery, redaction, rotation and degraded-state semantics; the adapter owns only the browser storage mechanism.

`identity.mjs` implements the neutral `ordax.identity-session/1` port. Its current snapshot is deliberately `unavailable`: there is no provider-specific authentication integration yet, so the adapter must not claim a signed-out or signed-in account state that it cannot actually establish. A future provider implementation replaces this adapter behavior without changing the shared Account app or Surface contract.

`identity-actions.mjs` implements the separate `ordax.identity-actions/1` command port. It currently advertises no supported commands and rejects execution, because Web has no real authentication provider yet. The contract exposes only provider-neutral `sign-in` / `sign-out` command families; OAuth redirects, passkeys, Google, Microsoft or another provider remain adapter/integration choices rather than shared product semantics.

Session state and command support are intentionally separate ports. `system/services/account/` validates their relationship with runtime capabilities so adapters cannot advertise account actions while identity itself is unavailable. The Surface chooses the context-appropriate action from the current session and never needs provider-specific branches.

The Web preference store currently persists only the shared preference snapshot supplied by the Surface. It does not imply account sync, server backup or secure-secret storage.

This adapter deliberately does **not** claim that account or sync services are implemented merely because those capabilities belong to the Web product baseline. Runtime capability snapshots describe what the current host actually exposes.

`system/composition/web/` is responsible for wiring Web adapters to the shared Surface. Adapter modules never import the Surface.
