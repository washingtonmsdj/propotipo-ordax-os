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

Concrete logging libraries, metrics stores and telemetry vendors may change later without changing these product semantics.
