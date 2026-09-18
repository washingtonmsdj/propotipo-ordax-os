# Shared Sync Service Boundary

`system/services/sync/` is the canonical owner for cross-device synchronization semantics. It is provider-neutral: database choice, hosting provider, transport plumbing and platform lifecycle integration stay outside the domain contract.

The machine-readable authority is `docs/contracts/sync-model.json`.

## Implemented local protocol core

`runtime.mjs` now implements the first provider-independent slice for the `appearance` data class:

- versioned `appearance/theme` sync objects with mandatory server revisions;
- explicit tombstones rather than ambiguous absence;
- deterministic conflict resolution where the greater server revision wins;
- fail-closed handling when the same server revision contains divergent state;
- versioned appearance mutations with caller-supplied idempotency keys;
- an in-memory offline mutation queue that deduplicates retries and rejects reuse of one idempotency key for different mutations.

This is **not** an account backend and does not make account continuity active. `SYNC_CORE_STATUS` deliberately reports identity and transport as `host-required`. A platform/remote adapter must still provide authenticated identity, authorization and encrypted transport before `account.identity` or `sync.safe-state` may be advertised as runtime capabilities.

The shared Surface now also has a local preference-sync bridge. It observes the live `ordax.preference-runtime/1` state, converts appearance changes into canonical idempotent appearance mutations and exposes only local queue/status through `ordax.sync-runtime/1`. Repeated offline theme changes compact to the newest pending value for the single stable `appearance/theme` object. This bridge does not publish anything by itself and does not advertise cloud/account continuity.

Core rules remain:

- one OrdaX identity spans Web, Mobile, Desktop, USB and native-disk modes;
- shared data classes have stable IDs and versioned object schemas;
- platform adapters provide secure storage, background execution and transport integration, but do not redefine conflict or entitlement policy;
- mutations are idempotent so reconnect/retry does not duplicate state;
- incremental cursors are opaque implementation details and clients must tolerate a safe full resync;
- server revisions, not client wall clocks, are the conflict authority;
- deletion is explicit state (tombstone), not an ambiguous absence;
- there is no universal last-writer-wins rule; conflict resolution is deterministic and versioned per data class/content type;
- device-private material, machine-local privileged state and other never-sync classes cannot become syncable through a paid plan;
- changing database/provider must not require changing the client-facing domain model.
