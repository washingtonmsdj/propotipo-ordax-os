# Diagnostics and Reliability Boundary

`system/services/diagnostics/` owns provider-neutral diagnostic semantics. The machine-readable authority is `docs/contracts/diagnostics.json`.

The goal is to make failures understandable as OrdaX grows without turning one logging vendor, cloud collector or console format into architecture.

Core rules:

- actionable failures use stable machine-readable error/event codes; human text may be localized or improved without changing identity;
- events are structured and schema-versioned, with optional correlation/operation and release identity;
- secrets, tokens, private keys and destructive authorization material never enter logs or exported bundles;
- user content is excluded by default and identifying fields require explicit classification;
- local diagnostics work offline and use bounded retention/rotation so logs cannot consume the disk indefinitely;
- readiness and liveness are distinct; supervised services detect crash loops and use restart backoff instead of tight restart loops;
- remote telemetry is optional, asynchronous and provider-neutral; telemetry failure never blocks boot, release activation or recovery;
- diagnostic bundles are explicit exports with redaction and an inclusion manifest.

## Implemented local journal core

The local update journal is now split into explicit layers:

- `journal.mjs` owns the structured `ordax.diagnostic-event/2` event model, stable update event identity, severity derivation, correlation and bounded rotation;
- `runtime.mjs` owns recovery and persistence semantics without knowing any browser, native host or storage API;
- `system/contracts/diagnostic-journal-store.mjs` is the only persistence boundary exposed to the service.

The runtime keeps diagnostics usable when persistence is absent or unhealthy. A missing store is explicitly session-scoped. A corrupt or unreadable persisted payload starts with an empty in-memory journal and reports `degraded` instead of failing product startup. A failed save keeps the validated event in memory, and a later successful write restores the configured persistence scope. Writes are serialized so an older delayed write cannot overwrite a newer journal state.

Persisted state is schema-versioned, size-bounded and contains only already validated/redacted diagnostic events. Retention is applied before serialization and again during recovery. The store contract intentionally does not define files, browser storage, HTTP endpoints or a telemetry vendor; those are adapter responsibilities.

Concrete logging libraries, metrics stores and telemetry vendors may change later without changing these product semantics.
