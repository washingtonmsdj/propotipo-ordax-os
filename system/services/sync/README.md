# Shared Sync Service Boundary

`system/services/sync/` is the canonical owner for cross-device synchronization semantics. It is intentionally provider-neutral: database choice, hosting provider, transport plumbing and platform lifecycle integrations are implementation details outside the domain contract.

The machine-readable contract is `docs/contracts/sync-model.json`.

Core rules:

- one OrdaX identity spans Web, Mobile, Desktop, USB and native-disk modes;
- shared data classes have stable IDs and versioned object schemas;
- platform adapters provide secure storage, background execution and transport integration, but do not redefine conflict or entitlement policy;
- mutations are designed to be idempotent so reconnect/retry does not duplicate state;
- incremental cursors are opaque implementation details and clients must tolerate a safe full resync;
- server revisions, not client wall clocks, are the conflict authority;
- deletion is explicit state (tombstone), not an ambiguous absence;
- there is no universal last-writer-wins rule; conflict resolution is deterministic and versioned per data class/content type;
- device-private keys, machine secrets, raw-disk state and other never-sync classes cannot become syncable through a paid plan;
- changing database/provider must not require changing the client-facing domain model.

This directory does not choose a backend yet. Implementation should arrive behind this boundary when the account/sync service is built, so early infrastructure choices do not become permanent product architecture.
