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

The local update journal is split into explicit layers:

- `redaction.mjs` owns the shared bounded diagnostic text redaction policy;
- `journal.mjs` owns the structured `ordax.diagnostic-event/2` event model, stable update event identity, severity derivation, correlation and bounded rotation;
- `runtime.mjs` owns recovery, runtime snapshot validation and persistence semantics without knowing any browser, native host or storage API;
- `system/contracts/diagnostic-journal-store.mjs` is the only persistence boundary exposed to the service;
- the Native adapter persists through its dedicated loopback endpoint and private device file; that mechanism is not part of the shared service contract.

The runtime keeps diagnostics usable when persistence is absent or unhealthy. A missing store is explicitly session-scoped. A corrupt or unreadable persisted payload starts with an empty in-memory journal and reports `degraded` instead of failing product startup. A failed save keeps the validated event in memory, and a later successful write restores the configured persistence scope. Writes are serialized so an older delayed write cannot overwrite a newer journal state.

Persisted state is schema-versioned, size-bounded and contains only already validated/redacted diagnostic events. Retention is applied before serialization and again during recovery. The store contract intentionally does not define files, browser storage, HTTP endpoints or a telemetry vendor; those are adapter responsibilities.

## Reviewable local report

`report.mjs` builds `ordax.diagnostic-report/2` from validated, allowlisted local snapshots. The report can include Surface state, update status, aggregate system metrics, bounded update history and the validated local journal. Journal persistence health is part of the review material, so a failed or stale persistence path cannot be presented as if durable diagnostics were healthy.

The report never serializes the diagnostic store payload directly. Event fields are copied through an explicit allowlist, text passes through the shared redaction policy, and update health authorization material is represented only as a boolean presence signal rather than exported token bytes.

`createDiagnosticReportDocument()` creates a deterministic local JSON document from the already validated/redacted report. It does **not** write a file, trigger a browser download or send data remotely. Review, save/export and any future remote submission are separate explicit product actions and must remain outside the diagnostic domain model.

## Explicit review collection

`review.mjs` is the on-demand collection layer for a future `Sistema > Diagnóstico` review flow. Calling `createDiagnosticReview()` is itself the explicit collection action; the service does not poll, subscribe, schedule work, download files or transmit data.

The collector only consumes neutral product ports for Surface state, update status, system metrics and update history, plus the provider-neutral local diagnostic journal runtime. Each source is recorded in a manifest as `included`, `unavailable` or `failed`. Operational read failures are fail-soft and expose only stable failure codes; raw exception text is never copied into the review document. If Surface state itself cannot be read, the review uses an explicit `unknown` fallback rather than inventing healthy state.

Update freshness is evaluated at the review timestamp through the shared update freshness service. Freshness describes observation age only: a stale observation is not proof that the supervisor is dead, and a fresh observation is not a health verdict.

`createDiagnosticReviewDocument()` serializes the review envelope, manifest, freshness observation and redacted report into deterministic JSON. It still does not write, download or upload anything. Physical save/export and any future support submission remain separate explicit actions.

## Sanitized text summary and explicit copy

`summary.mjs` creates the bounded `ordax.diagnostic-summary/1` plain-text representation intended for the explicit **Copiar resumo sanitizado** action. It reconstructs the text only from the structured review envelope; the serialized `document.text` JSON is never used as summary input. Allowlisted diagnostic text passes through the shared redaction policy again as defense in depth.

The summary validates that the source manifest agrees with the structured report before presenting it. An included source must have its corresponding report section, unavailable/failed sources must not smuggle a section back into the summary, update freshness requires an update observation, and journal event count must agree with the bounded event list. Missing or empty journal data is described as an observation limitation, never as proof that the system is healthy.

`system/contracts/diagnostic-copy.mjs` is deliberately narrow: it accepts only a bounded UTF-8 plain-text diagnostic summary and exposes one `copy(summary)` action. `copy.mjs` converts adapter failures to the stable `copy-failed` code without carrying exception strings. The Web adapter delegates only to `clipboard.writeText()` at explicit action time; it has no `execCommand` fallback, storage access, network request or raw-document path. Clipboard availability/permission remains a host capability rather than something the shared diagnostic service fakes.

## Explicit review controller

`controller.mjs` is the narrow orchestration boundary intended for the diagnostic UI. The Surface does not call collectors, redaction/summary logic, clipboard adapters or export services separately. It asks the controller to `prepare()` a review and, only after review, may call `copyPreparedSummary()` or `exportPrepared()`.

The controller never accepts an arbitrary document argument for either output action. Only the exact latest review produced by its own `prepare()` lifecycle can cross copy/export boundaries. Starting a newer review immediately invalidates older prepared material; an older in-flight collection that finishes later returns `superseded` instead of restoring stale content.

Copy and export share one output single-flight boundary. Copy creates the sanitized text from the prepared structured review and does not consume that review; after a successful copy the same reviewed document remains ready for an explicit save. A successful save consumes the prepared review so repeated activation cannot silently write it twice. Cancellation or a stable output failure keeps the prepared review available for an explicit retry. Missing capability, missing prepared review and concurrent output are represented by stable non-secret codes rather than exception text. A structural preparation failure is also converted to the stable `review-prepare-failed` result instead of leaking an exception to presentation code.

For presentation, the controller exposes immutable `ordax.diagnostic-review-controller-state/1` snapshots through `getSnapshot()` and `subscribe(listener)`. The observable phase is one of `idle`, `preparing`, `ready`, `copying` or `exporting`; snapshots expose whether copy/export are available, the exact prepared review document when one exists, and the last stable action result. Subscription immediately replays the current state. Subscriber exceptions are isolated so a broken view cannot interrupt collection or output semantics.

The controller remains provider- and platform-neutral. Physical Native persistence is supplied through `ordax.diagnostic-export/1`; the Native adapter saves confirmed UTF-8 JSON into the bounded user `/Downloads` space through the existing file-space capability. Clipboard access remains behind `ordax.diagnostic-copy/1`; browser APIs stay in adapters rather than the controller or Surface. No browser, filesystem path, Native endpoint or telemetry provider is part of the controller semantics.

Concrete logging libraries, metrics stores and telemetry vendors may change later without changing these product semantics.
